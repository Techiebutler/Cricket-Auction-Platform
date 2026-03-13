import secrets
import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_

from app.core.database import get_db
from app.core.deps import require_role
from app.core.redis import get_redis
from app.models.user import User, ROLE_ORGANIZER, ROLE_CAPTAIN, ROLE_AUCTIONEER
from app.models.auction import AuctionEvent, Team, AuctionPlayer, AuctionStatus, TeamPlayer, PlayerAuctionStatus
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
from app.services.s3_service import upload_file
from app.core.queue import enqueue

INVITE_TTL_SECONDS = 60 * 60 * 24 * 7


class AuctioneerInvitePayload(BaseModel):
    email: EmailStr


class PlayerInvitePayload(BaseModel):
    email: EmailStr


class EventSettingsUpdatePayload(BaseModel):
    scheduled_at: datetime | None = None
    team_budget: int | None = Field(default=None, ge=1000)
    team_max_players: int | None = None
    player_base_price: int | None = Field(default=None, ge=100)

router = APIRouter(prefix="/organizer", tags=["organizer"])


async def _get_event_for_organizer(event_id: int, organizer: User, db: AsyncSession) -> AuctionEvent:
    result = await db.execute(select(AuctionEvent).where(AuctionEvent.id == event_id))
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.organizer_id != organizer.id:
        raise HTTPException(status_code=403, detail="Not your event")
    return event


@router.get("/users/search", response_model=list[UserOut])
async def search_users(
    q: str = Query(..., min_length=1),
    current_user: User = Depends(require_role(ROLE_ORGANIZER)),
    db: AsyncSession = Depends(get_db),
):
    """Search users by name or email — used by the invite widget for organizers."""
    pattern = f"%{q}%"
    result = await db.execute(
        select(User).where(
            or_(User.name.ilike(pattern), User.email.ilike(pattern))
        ).limit(8)
    )
    return [UserOut.model_validate(u) for u in result.scalars().all()]


@router.get("/users/{user_id}", response_model=UserOut)
async def get_user(
    user_id: int,
    current_user: User = Depends(require_role(ROLE_ORGANIZER)),
    db: AsyncSession = Depends(get_db),
):
    """Get a single user by ID"""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return UserOut.model_validate(user)


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
        base_price=event.player_base_price,
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
        budget=event.team_budget,
        max_players=event.team_max_players,
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

        # Handle removing old captain from roster if changing
        if team.captain_id and team.captain_id != payload.captain_id:
            old_cap_result = await db.execute(select(User).where(User.id == team.captain_id))
            old_cap = old_cap_result.scalar_one_or_none()
            if old_cap:
                old_cap.remove_role(ROLE_CAPTAIN)
            
            # Remove old captain from TeamPlayer (if they were added for 0 price)
            old_tp_res = await db.execute(
                select(TeamPlayer).where(
                    TeamPlayer.team_id == team.id,
                    TeamPlayer.player_id == team.captain_id,
                    TeamPlayer.sold_price == 0
                )
            )
            old_tp = old_tp_res.scalar_one_or_none()
            if old_tp:
                await db.delete(old_tp)
                
            # Revert old captain in AuctionPlayer back to pending
            old_ap_res = await db.execute(
                select(AuctionPlayer).where(
                    AuctionPlayer.event_id == event_id,
                    AuctionPlayer.player_id == team.captain_id
                )
            )
            old_ap = old_ap_res.scalar_one_or_none()
            if old_ap and old_ap.status == PlayerAuctionStatus.sold and old_ap.current_bid == 0:
                old_ap.status = PlayerAuctionStatus.pending
                old_ap.current_bidder_id = None
                old_ap.current_bid = 0

        team.captain_id = payload.captain_id
        
        # Add new captain to TeamPlayer if not already there
        tp_res = await db.execute(
            select(TeamPlayer).where(
                TeamPlayer.team_id == team.id,
                TeamPlayer.player_id == payload.captain_id
            )
        )
        if not tp_res.scalar_one_or_none():
            tp = TeamPlayer(team_id=team.id, player_id=payload.captain_id, sold_price=0)
            db.add(tp)
            
        # Ensure new captain is in AuctionPlayer and marked as 'sold'
        ap_res = await db.execute(
            select(AuctionPlayer).where(
                AuctionPlayer.event_id == event_id,
                AuctionPlayer.player_id == payload.captain_id
            )
        )
        ap = ap_res.scalar_one_or_none()
        if ap:
            ap.status = PlayerAuctionStatus.sold
            ap.current_bidder_id = payload.captain_id
            ap.current_bid = 0
        else:
            ap = AuctionPlayer(
                event_id=event_id,
                player_id=payload.captain_id,
                base_price=event.player_base_price,
                status=PlayerAuctionStatus.sold,
                current_bid=0,
                current_bidder_id=payload.captain_id,
                auction_order=0
            )
            db.add(ap)

    if payload.budget is not None:
        team.budget = payload.budget
    if payload.max_players is not None:
        team.max_players = payload.max_players

    await db.commit()
    await db.refresh(team)
    return TeamOut.model_validate(team)


@router.delete("/events/{event_id}/teams/{team_id}", status_code=204)
async def delete_team(
    event_id: int,
    team_id: int,
    current_user: User = Depends(require_role(ROLE_ORGANIZER)),
    db: AsyncSession = Depends(get_db),
):
    """Delete a team from the event. Only allowed in draft status."""
    event = await _get_event_for_organizer(event_id, current_user, db)
    if event.status != AuctionStatus.draft:
        raise HTTPException(status_code=400, detail="Cannot delete team after event is published")

    result = await db.execute(select(Team).where(Team.id == team_id, Team.event_id == event_id))
    team = result.scalar_one_or_none()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    # If team has a captain, remove their captain role and revert AuctionPlayer status
    if team.captain_id:
        cap_result = await db.execute(select(User).where(User.id == team.captain_id))
        cap_user = cap_result.scalar_one_or_none()
        if cap_user:
            cap_user.remove_role(ROLE_CAPTAIN)

        # Revert captain's AuctionPlayer status back to pending
        ap_res = await db.execute(
            select(AuctionPlayer).where(
                AuctionPlayer.event_id == event_id,
                AuctionPlayer.player_id == team.captain_id
            )
        )
        ap = ap_res.scalar_one_or_none()
        if ap and ap.status == PlayerAuctionStatus.sold and ap.current_bid == 0:
            ap.status = PlayerAuctionStatus.pending
            ap.current_bidder_id = None

    # Delete all TeamPlayers for this team
    await db.execute(
        TeamPlayer.__table__.delete().where(TeamPlayer.team_id == team_id)
    )

    await db.delete(team)
    await db.commit()
    return None


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


@router.patch("/events/{event_id}/settings", response_model=AuctionEventOut)
async def update_settings(
    event_id: int,
    payload: EventSettingsUpdatePayload,
    current_user: User = Depends(require_role(ROLE_ORGANIZER)),
    db: AsyncSession = Depends(get_db),
):
    """
    Allow organizer to adjust the auction date/time, global budget, max players, and player base price for their event.
    """
    event = await _get_event_for_organizer(event_id, current_user, db)
    if event.status != AuctionStatus.draft:
        raise HTTPException(status_code=400, detail="Cannot change settings after event is published")
    if payload.scheduled_at is not None:
        event.scheduled_at = payload.scheduled_at
    if payload.team_budget is not None:
        event.team_budget = payload.team_budget
    if payload.team_max_players is not None:
        event.team_max_players = payload.team_max_players
    if payload.player_base_price is not None:
        event.player_base_price = payload.player_base_price

    # Also update all existing teams in this event
    if payload.team_budget is not None or payload.team_max_players is not None:
        teams_result = await db.execute(select(Team).where(Team.event_id == event_id))
        teams = teams_result.scalars().all()
        for t in teams:
            if payload.team_budget is not None:
                t.budget = payload.team_budget
            if payload.team_max_players is not None:
                t.max_players = payload.team_max_players
                
    # Update existing players' base prices if it changed
    if payload.player_base_price is not None:
        players_result = await db.execute(select(AuctionPlayer).where(AuctionPlayer.event_id == event_id))
        players = players_result.scalars().all()
        for p in players:
            p.base_price = payload.player_base_price

    await db.commit()
    await db.refresh(event)
    return AuctionEventOut.model_validate(event)


@router.post("/events/{event_id}/logo", response_model=AuctionEventOut)
async def upload_event_logo(
    event_id: int,
    file: UploadFile = File(...),
    current_user: User = Depends(require_role(ROLE_ORGANIZER)),
    db: AsyncSession = Depends(get_db),
):
    """Upload a logo for the event."""
    event = await _get_event_for_organizer(event_id, current_user, db)
    
    # Validate file type
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")
    
    # Read file content
    content = await file.read()
    if len(content) > 5 * 1024 * 1024:  # 5MB limit
        raise HTTPException(status_code=400, detail="File too large (max 5MB)")
    
    # Upload to S3
    url = upload_file(content, key_prefix=f"event-logos/{event_id}", content_type=file.content_type)
    if not url:
        raise HTTPException(status_code=500, detail="Failed to upload logo. S3 may not be configured.")
    
    event.logo = url
    await db.commit()
    await db.refresh(event)
    return AuctionEventOut.model_validate(event)


@router.delete("/events/{event_id}/logo", response_model=AuctionEventOut)
async def delete_event_logo(
    event_id: int,
    current_user: User = Depends(require_role(ROLE_ORGANIZER)),
    db: AsyncSession = Depends(get_db),
):
    """Remove the event logo."""
    event = await _get_event_for_organizer(event_id, current_user, db)
    event.logo = None
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
            base_price=event.player_base_price,
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
