import secrets
import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.deps import require_role
from app.core.redis import get_redis
from app.models.user import User, ROLE_ORGANIZER, ROLE_CAPTAIN, ROLE_AUCTIONEER
from app.models.auction import AuctionEvent, Team, AuctionPlayer, AuctionStatus
from app.schemas.auction import (
    AuctionPlayerCreate,
    AuctionPlayerOut,
    TeamCreate,
    TeamUpdate,
    TeamOut,
    AuctionEventOut,
)
from app.schemas.user import UserOut
from app.services import email_service
from app.core.queue import enqueue

INVITE_TTL_SECONDS = 60 * 60 * 24 * 7


class AuctioneerInvitePayload(BaseModel):
    email: EmailStr


class PlayerInvitePayload(BaseModel):
    email: EmailStr


class ScheduleUpdatePayload(BaseModel):
    scheduled_at: datetime | None

router = APIRouter(prefix="/organizer", tags=["organizer"])


async def _get_event_for_organizer(event_id: int, organizer: User, db: AsyncSession) -> AuctionEvent:
    result = await db.execute(select(AuctionEvent).where(AuctionEvent.id == event_id))
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.organizer_id != organizer.id:
        raise HTTPException(status_code=403, detail="Not your event")
    return event


@router.get("/events", response_model=list[AuctionEventOut])
async def list_my_events(
    current_user: User = Depends(require_role(ROLE_ORGANIZER)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(AuctionEvent).where(AuctionEvent.organizer_id == current_user.id)
    )
    return [AuctionEventOut.model_validate(e) for e in result.scalars().all()]


@router.get("/events/{event_id}/eligible-players", response_model=list[UserOut])
async def eligible_players(
    event_id: int,
    current_user: User = Depends(require_role(ROLE_ORGANIZER)),
    db: AsyncSession = Depends(get_db),
):
    event = await _get_event_for_organizer(event_id, current_user, db)

    result = await db.execute(select(User))
    users = result.scalars().all()

    if not event.allowed_domains:
        return [UserOut.model_validate(u) for u in users]

    eligible = [
        u for u in users
        if any(u.email.endswith(f"@{d}") for d in event.allowed_domains)
    ]
    return [UserOut.model_validate(u) for u in eligible]


@router.post("/events/{event_id}/players", response_model=AuctionPlayerOut, status_code=201)
async def add_player(
    event_id: int,
    payload: AuctionPlayerCreate,
    current_user: User = Depends(require_role(ROLE_ORGANIZER)),
    db: AsyncSession = Depends(get_db),
):
    event = await _get_event_for_organizer(event_id, current_user, db)
    if event.status != AuctionStatus.draft:
        raise HTTPException(status_code=400, detail="Cannot modify players after event is published")

    existing = await db.execute(
        select(AuctionPlayer).where(
            AuctionPlayer.event_id == event_id,
            AuctionPlayer.player_id == payload.player_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Player already added")

    count_result = await db.execute(
        select(AuctionPlayer).where(AuctionPlayer.event_id == event_id)
    )
    count = len(count_result.scalars().all())

    ap = AuctionPlayer(
        event_id=event_id,
        player_id=payload.player_id,
        base_price=payload.base_price,
        auction_order=count + 1,
    )
    db.add(ap)
    await db.commit()
    await db.refresh(ap)
    # Emails are sent in bulk when organizer marks the event ready — not here
    return AuctionPlayerOut.model_validate(ap)


@router.get("/events/{event_id}/players", response_model=list[AuctionPlayerOut])
async def list_event_players(
    event_id: int,
    current_user: User = Depends(require_role(ROLE_ORGANIZER)),
    db: AsyncSession = Depends(get_db),
):
    await _get_event_for_organizer(event_id, current_user, db)
    result = await db.execute(
        select(AuctionPlayer).where(AuctionPlayer.event_id == event_id)
    )
    return [AuctionPlayerOut.model_validate(ap) for ap in result.scalars().all()]


@router.delete("/events/{event_id}/players/{player_id}", status_code=204)
async def remove_player(
    event_id: int,
    player_id: int,
    current_user: User = Depends(require_role(ROLE_ORGANIZER)),
    db: AsyncSession = Depends(get_db),
):
    event = await _get_event_for_organizer(event_id, current_user, db)
    if event.status != AuctionStatus.draft:
        raise HTTPException(status_code=400, detail="Cannot modify players after event is published")
    result = await db.execute(
        select(AuctionPlayer).where(
            AuctionPlayer.event_id == event_id,
            AuctionPlayer.player_id == player_id,
        )
    )
    ap = result.scalar_one_or_none()
    if not ap:
        raise HTTPException(status_code=404, detail="Player not in this event")
    if ap.status != "pending":
        raise HTTPException(status_code=400, detail="Cannot remove a player already in auction")
    await db.delete(ap)
    await db.commit()


@router.post("/events/{event_id}/teams", response_model=TeamOut, status_code=201)
async def create_team(
    event_id: int,
    payload: TeamCreate,
    current_user: User = Depends(require_role(ROLE_ORGANIZER)),
    db: AsyncSession = Depends(get_db),
):
    event = await _get_event_for_organizer(event_id, current_user, db)
    if event.status != AuctionStatus.draft:
        raise HTTPException(status_code=400, detail="Cannot modify teams after event is published")

    team = Team(
        event_id=event_id,
        name=payload.name,
        color=payload.color,
        budget=payload.budget,
        max_players=payload.max_players,
    )
    db.add(team)
    await db.commit()
    await db.refresh(team)
    return TeamOut.model_validate(team)


@router.get("/events/{event_id}/teams", response_model=list[TeamOut])
async def list_teams(
    event_id: int,
    current_user: User = Depends(require_role(ROLE_ORGANIZER)),
    db: AsyncSession = Depends(get_db),
):
    await _get_event_for_organizer(event_id, current_user, db)
    result = await db.execute(select(Team).where(Team.event_id == event_id))
    return [TeamOut.model_validate(t) for t in result.scalars().all()]


@router.patch("/events/{event_id}/teams/{team_id}", response_model=TeamOut)
async def update_team(
    event_id: int,
    team_id: int,
    payload: TeamUpdate,
    current_user: User = Depends(require_role(ROLE_ORGANIZER)),
    db: AsyncSession = Depends(get_db),
):
    event = await _get_event_for_organizer(event_id, current_user, db)
    if event.status != AuctionStatus.draft:
        raise HTTPException(status_code=400, detail="Cannot modify teams after event is published")

    result = await db.execute(
        select(Team).where(Team.id == team_id, Team.event_id == event_id)
    )
    team = result.scalar_one_or_none()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    if payload.name is not None:
        team.name = payload.name
    if payload.color is not None:
        team.color = payload.color
    if payload.captain_id is not None:
        # Auto-grant captain role to assigned user
        cap_result = await db.execute(select(User).where(User.id == payload.captain_id))
        cap_user = cap_result.scalar_one_or_none()
        if cap_user:
            cap_user.add_role(ROLE_CAPTAIN)
            # Email queued — will fire when organizer marks event ready
        # Remove captain role from old captain if changing
        if team.captain_id and team.captain_id != payload.captain_id:
            old_cap_result = await db.execute(select(User).where(User.id == team.captain_id))
            old_cap = old_cap_result.scalar_one_or_none()
            if old_cap:
                old_cap.remove_role(ROLE_CAPTAIN)
        team.captain_id = payload.captain_id
    if payload.budget is not None:
        team.budget = payload.budget
    if payload.max_players is not None:
        team.max_players = payload.max_players

    await db.commit()
    await db.refresh(team)
    return TeamOut.model_validate(team)


@router.post("/events/{event_id}/invite-auctioneer", response_model=dict)
async def invite_auctioneer(
    event_id: int,
    payload: AuctioneerInvitePayload,
    current_user: User = Depends(require_role(ROLE_ORGANIZER)),
    db: AsyncSession = Depends(get_db),
):
    """
    Assign or invite an auctioneer.
    - Existing user → grants role + assigns immediately.
    - Unknown email → sends invite link (same token flow as admin invite).
    """
    event = await _get_event_for_organizer(event_id, current_user, db)
    if event.status != AuctionStatus.draft:
        raise HTTPException(status_code=400, detail="Cannot change auctioneer after event is published")

    user_result = await db.execute(select(User).where(User.email == payload.email))
    ae_user = user_result.scalar_one_or_none()

    if ae_user:
        ae_user.add_role(ROLE_AUCTIONEER)
        event.auctioneer_id = ae_user.id
        await db.commit()
        await db.refresh(ae_user)
        # Email queued — will fire when organizer marks event ready
        return {
            "status": "assigned",
            "user": UserOut.model_validate(ae_user).model_dump(),
            "message": f"{ae_user.name} assigned as auctioneer",
        }
    else:
        token = secrets.token_urlsafe(32)
        redis = await get_redis()
        invite_data = {
            "email": payload.email,
            "event_id": event_id,
            "event_name": event.name,
            "role": "auctioneer",
        }
        await redis.setex(f"invite:{token}", INVITE_TTL_SECONDS, json.dumps(invite_data))
        await enqueue("task_send_organizer_invite", payload.email, event.name, token, "auctioneer")
        return {
            "status": "invited",
            "user": None,
            "message": f"Invitation sent to {payload.email}",
        }


@router.patch("/events/{event_id}/schedule", response_model=AuctionEventOut)
async def update_schedule(
    event_id: int,
    payload: ScheduleUpdatePayload,
    current_user: User = Depends(require_role(ROLE_ORGANIZER)),
    db: AsyncSession = Depends(get_db),
):
    """
    Allow organizer to adjust the auction date/time for their event.
    """
    event = await _get_event_for_organizer(event_id, current_user, db)
    if event.status != AuctionStatus.draft:
        raise HTTPException(status_code=400, detail="Cannot change schedule after event is published")
    event.scheduled_at = payload.scheduled_at
    await db.commit()
    await db.refresh(event)
    return AuctionEventOut.model_validate(event)


@router.patch("/events/{event_id}/ready", response_model=AuctionEventOut)
async def mark_ready(
    event_id: int,
    current_user: User = Depends(require_role(ROLE_ORGANIZER)),
    db: AsyncSession = Depends(get_db),
):
    event = await _get_event_for_organizer(event_id, current_user, db)

    # Validate readiness before allowing mark-ready
    teams_result = await db.execute(select(Team).where(Team.event_id == event_id))
    teams = teams_result.scalars().all()

    players_result = await db.execute(select(AuctionPlayer).where(AuctionPlayer.event_id == event_id))
    players = players_result.scalars().all()

    errors = []
    if not event.auctioneer_id:
        errors.append("Auctioneer not assigned")
    if len(teams) < 2:
        errors.append(f"Need at least 2 teams (have {len(teams)})")
    teams_without_captain = [t for t in teams if not t.captain_id]
    if teams_without_captain:
        names = ", ".join(t.name for t in teams_without_captain)
        errors.append(f"Teams missing captain: {names}")
    if len(players) == 0:
        errors.append("No players added yet")

    if errors:
        raise HTTPException(status_code=400, detail={"errors": errors})

    event.status = AuctionStatus.ready
    await db.commit()
    await db.refresh(event)

    # ── Bulk notifications now that event is confirmed ready ──────────────────
    # Players
    for ap in players:
        p_res = await db.execute(select(User).where(User.id == ap.player_id))
        p = p_res.scalar_one_or_none()
        if p:
            await enqueue("task_send_event_invitation", p.email, p.name, event.name, event.id, "player")

    # Captains
    for team in teams:
        if team.captain_id:
            c_res = await db.execute(select(User).where(User.id == team.captain_id))
            c = c_res.scalar_one_or_none()
            if c:
                await enqueue("task_send_event_invitation", c.email, c.name, event.name, event.id, "captain")

    # Auctioneer
    if event.auctioneer_id:
        ae_res = await db.execute(select(User).where(User.id == event.auctioneer_id))
        ae = ae_res.scalar_one_or_none()
        if ae:
            await enqueue("task_send_event_invitation", ae.email, ae.name, event.name, event.id, "auctioneer")

    return AuctionEventOut.model_validate(event)


@router.patch("/events/{event_id}/unpublish", response_model=AuctionEventOut)
async def unpublish_event(
    event_id: int,
    current_user: User = Depends(require_role(ROLE_ORGANIZER)),
    db: AsyncSession = Depends(get_db),
):
    """
    Move event back to draft.
    Only allowed while status is 'ready' (auction has not started yet).
    """
    event = await _get_event_for_organizer(event_id, current_user, db)
    if event.status != AuctionStatus.ready:
        raise HTTPException(status_code=400, detail="Only ready events can be unpublished")

    event.status = AuctionStatus.draft
    await db.commit()
    await db.refresh(event)
    return AuctionEventOut.model_validate(event)


@router.post("/events/{event_id}/invite-player", response_model=dict)
async def invite_player(
    event_id: int,
    payload: PlayerInvitePayload,
    current_user: User = Depends(require_role(ROLE_ORGANIZER)),
    db: AsyncSession = Depends(get_db),
):
    """
    Invite a player to the event by email.
    - Domain must match event's allowed_domains (if set).
    - If user already exists → add them to the player pool directly.
    - If not registered → send invite email; on registration they'll be added.
    """
    event = await _get_event_for_organizer(event_id, current_user, db)
    if event.status != AuctionStatus.draft:
        raise HTTPException(status_code=400, detail="Cannot invite players after event is published")

    # Domain validation
    if event.allowed_domains:
        email_domain = payload.email.split("@")[1].lower()
        allowed = [d.lower().strip() for d in event.allowed_domains]
        if email_domain not in allowed:
            raise HTTPException(
                status_code=400,
                detail=f"Email domain '{email_domain}' is not allowed. Allowed: {', '.join(allowed)}",
            )

    user_result = await db.execute(select(User).where(User.email == payload.email))
    user = user_result.scalar_one_or_none()

    if user:
        # Check if already added
        existing = await db.execute(
            select(AuctionPlayer).where(
                AuctionPlayer.event_id == event_id,
                AuctionPlayer.player_id == user.id,
            )
        )
        if existing.scalar_one_or_none():
            return {"status": "already_added", "user": UserOut.model_validate(user).model_dump(), "message": f"{user.name} is already in the player pool"}

        count_result = await db.execute(select(AuctionPlayer).where(AuctionPlayer.event_id == event_id))
        count = len(count_result.scalars().all())

        ap = AuctionPlayer(
            event_id=event_id,
            player_id=user.id,
            base_price=100,
            auction_order=count + 1,
        )
        db.add(ap)
        await db.commit()
        email_service.send_event_invitation(user.email, user.name, event.name, event.id, "player")
        return {
            "status": "added",
            "user": UserOut.model_validate(user).model_dump(),
            "message": f"{user.name} added to player pool",
        }
    else:
        # Unknown email — send invite
        token = secrets.token_urlsafe(32)
        redis = await get_redis()
        invite_data = {
            "email": payload.email,
            "event_id": event_id,
            "event_name": event.name,
            "role": "player",
        }
        await redis.setex(f"invite:{token}", INVITE_TTL_SECONDS, json.dumps(invite_data))
        await enqueue("task_send_organizer_invite", payload.email, event.name, token, "player")
        return {
            "status": "invited",
            "user": None,
            "message": f"Invitation sent to {payload.email}",
        }
