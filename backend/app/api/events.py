"""
Public events API — accessible by any authenticated user.
Powers the main dashboard event listing.

Visibility rules:
  - draft  → visible only to the event's admin and organizer
  - ready / active / paused / completed → visible to everyone
"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User, ROLE_ADMIN
from app.models.auction import AuctionEvent, AuctionStatus, Team, AuctionPlayer
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

router = APIRouter(prefix="/events", tags=["events"])


class EventCardOut(BaseModel):
    id: int
    name: str
    description: Optional[str]
    status: str
    allowed_domains: list[str]
    team_count: int
    player_count: int
    auctioneer_id: Optional[int]
    scheduled_at: Optional[datetime]
    created_at: datetime
    my_roles: list[str] = []  # all roles this user has in this event
    viewer_count: Optional[int] = None  # live viewers or total unique viewers for completed
    logo: Optional[str] = None  # event logo URL


def _can_see_draft(event: AuctionEvent, user: User) -> bool:
    """Draft events are only visible to the creating admin and the assigned organizer."""
    return event.admin_id == user.id or event.organizer_id == user.id


@router.get("", response_model=list[EventCardOut])
async def list_all_events(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(AuctionEvent))
    events = result.scalars().all()
    visible = [
        e for e in events
        if e.status != AuctionStatus.draft or _can_see_draft(e, current_user)
    ]
    return [await _to_card(e, current_user, db) for e in visible]


@router.get("/mine", response_model=list[EventCardOut])
async def list_my_events(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Events where the current user has a role.
    Draft events are still filtered — only admin/organizer of that event see them here too.
    """
    uid = current_user.id

    # Events where user is admin / organizer / auctioneer (staff can always see their own drafts)
    staff_result = await db.execute(
        select(AuctionEvent).where(
            or_(
                AuctionEvent.admin_id == uid,
                AuctionEvent.organizer_id == uid,
                AuctionEvent.auctioneer_id == uid,
            )
        )
    )
    events = {e.id: e for e in staff_result.scalars().all()}

    # Captain — only non-draft events
    cap_result = await db.execute(
        select(AuctionEvent)
        .join(Team, Team.event_id == AuctionEvent.id)
        .where(Team.captain_id == uid, AuctionEvent.status != AuctionStatus.draft)
    )
    for e in cap_result.scalars().all():
        events[e.id] = e

    # Player in pool — only non-draft events
    ap_result = await db.execute(
        select(AuctionEvent)
        .join(AuctionPlayer, AuctionPlayer.event_id == AuctionEvent.id)
        .where(AuctionPlayer.player_id == uid, AuctionEvent.status != AuctionStatus.draft)
    )
    for e in ap_result.scalars().all():
        events[e.id] = e

    # For auctioneer — also apply draft filter (they only see ready/active/etc via their staff role)
    # Auctioneer is assigned before ready, so they can see their event even in draft
    # (already included via staff_result above)

    return [await _to_card(e, current_user, db) for e in events.values()]


@router.get("/{event_id}/readiness")
async def event_readiness(
    event_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Returns a checklist of what's done and what's missing before marking ready."""
    ev_result = await db.execute(select(AuctionEvent).where(AuctionEvent.id == event_id))
    event = ev_result.scalar_one_or_none()
    if not event:
        return {"error": "Not found"}

    teams_result = await db.execute(select(Team).where(Team.event_id == event_id))
    teams = teams_result.scalars().all()

    players_result = await db.execute(select(AuctionPlayer).where(AuctionPlayer.event_id == event_id))
    players = players_result.scalars().all()

    teams_with_captain = [t for t in teams if t.captain_id]

    checks = {
        "organizer_assigned": event.organizer_id is not None,
        "auctioneer_assigned": event.auctioneer_id is not None,
        "teams_created": len(teams) >= 2,
        "all_teams_have_captain": len(teams) > 0 and len(teams_with_captain) == len(teams),
        "players_added": len(players) >= 1,
    }
    return {
        "checks": checks,
        "ready": all(checks.values()),
        "teams_count": len(teams),
        "teams_with_captain": len(teams_with_captain),
        "players_count": len(players),
        "auctioneer_id": event.auctioneer_id,
        "status": event.status,
    }


async def _to_card(event: AuctionEvent, user: User, db: AsyncSession) -> EventCardOut:
    teams_result = await db.execute(select(Team).where(Team.event_id == event.id))
    teams = teams_result.scalars().all()

    players_result = await db.execute(select(AuctionPlayer).where(AuctionPlayer.event_id == event.id))
    players = players_result.scalars().all()

    uid = user.id
    my_roles: list[str] = []

    if event.admin_id == uid:
        my_roles.append("admin")
    if event.organizer_id == uid:
        my_roles.append("organizer")
    if event.auctioneer_id == uid:
        my_roles.append("auctioneer")
    if any(t.captain_id == uid for t in teams):
        my_roles.append("captain")
    if any(p.player_id == uid for p in players):
        my_roles.append("player")

    # Get viewer count for active/completed events
    viewer_count = None
    if event.status == AuctionStatus.completed:
        # Use persisted value from database for completed events
        viewer_count = event.total_viewers
    elif event.status in (AuctionStatus.active, AuctionStatus.paused):
        # Use live count from Redis for active events
        from app.ws.manager import manager
        stats = await manager.get_viewer_stats(event.id)
        viewer_count = stats.get("live_viewers", 0)

    return EventCardOut(
        id=event.id,
        name=event.name,
        description=event.description,
        status=event.status,
        allowed_domains=event.allowed_domains,
        team_count=len(teams),
        player_count=len(players),
        auctioneer_id=event.auctioneer_id,
        scheduled_at=event.scheduled_at,
        created_at=event.created_at,
        my_roles=my_roles,
        viewer_count=viewer_count,
        logo=event.logo,
    )
