import asyncio
import random
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.user import User
from app.models.auction import (
    AuctionEvent,
    AuctionPlayer,
    AuctionStatus,
    PlayerAuctionStatus,
    Bid,
    Team,
    TeamPlayer,
)
from app.core.redis import get_redis
from app.ws.manager import manager
from app.services import email_service
from app.core.queue import enqueue

TIMER_KEY = "auction:{event_id}:timer"
ACTIVE_PLAYER_KEY = "auction:{event_id}:active_player"
TIMER_SECONDS = 60

# Track running timer tasks per event
_timer_tasks: dict[int, asyncio.Task] = {}


def _timer_key(event_id: int) -> str:
    return f"auction:{event_id}:timer"


def _active_key(event_id: int) -> str:
    return f"auction:{event_id}:active_player"


async def get_auction_state(event_id: int, db: AsyncSession) -> dict:
    result = await db.execute(select(AuctionEvent).where(AuctionEvent.id == event_id))
    event = result.scalar_one_or_none()
    if not event:
        return {}

    teams_result = await db.execute(select(Team).where(Team.event_id == event_id))
    teams = teams_result.scalars().all()

    players_result = await db.execute(
        select(AuctionPlayer).where(AuctionPlayer.event_id == event_id)
    )
    players = players_result.scalars().all()

    redis = await get_redis()
    timer = await redis.get(_timer_key(event_id))
    active_player_id = await redis.get(_active_key(event_id))

    return {
        "type": "auction_state",
        "event_id": event_id,
        "status": event.status,
        "scheduled_at": event.scheduled_at.isoformat() if event.scheduled_at else None,
        "timer": int(timer) if timer else 0,
        "active_player_id": int(active_player_id) if active_player_id else None,
        "teams": [
            {
                "id": t.id,
                "name": t.name,
                "captain_id": t.captain_id,
                "budget": t.budget,
                "spent": t.spent,
                "max_players": t.max_players,
                "player_count": len(t.players),
            }
            for t in teams
        ],
        "players": [
            {
                "id": p.id,
                "player_id": p.player_id,
                "base_price": p.base_price,
                "current_bid": p.current_bid,
                "current_bidder_id": p.current_bidder_id,
                "status": p.status,
            }
            for p in players
        ],
    }


async def start_auction(event_id: int, db: AsyncSession) -> AuctionEvent:
    result = await db.execute(select(AuctionEvent).where(AuctionEvent.id == event_id))
    event = result.scalar_one_or_none()
    if not event:
        raise ValueError("Event not found")
    # Enforce scheduled start time if set
    if event.scheduled_at is not None:
        from datetime import datetime, timezone

        now = datetime.now(timezone.utc)
        if now < event.scheduled_at:
            raise ValueError("Auction can only be started after the scheduled time")
    if event.status not in (AuctionStatus.ready, AuctionStatus.paused):
        raise ValueError(f"Cannot start auction in status: {event.status}")

    event.status = AuctionStatus.active
    await db.commit()
    await db.refresh(event)

    state = await get_auction_state(event_id, db)
    await manager.broadcast(event_id, {**state, "type": "auction_resumed"})

    # Notify all participants on first start
    if event.status == AuctionStatus.active:
        players_result = await db.execute(
            select(AuctionPlayer).where(AuctionPlayer.event_id == event_id)
        )
        participant_ids = {ap.player_id for ap in players_result.scalars().all()}

        teams_result = await db.execute(select(Team).where(Team.event_id == event_id))
        captain_ids = {t.captain_id for t in teams_result.scalars().all() if t.captain_id}

        all_ids = participant_ids | captain_ids
        if event.auctioneer_id:
            all_ids.add(event.auctioneer_id)

        for uid in all_ids:
            user_res = await db.execute(select(User).where(User.id == uid))
            u = user_res.scalar_one_or_none()
            if u:
                role = "auctioneer" if uid == event.auctioneer_id else (
                    "captain" if uid in captain_ids else "player"
                )
                await enqueue("task_send_auction_starting", u.email, u.name, event.name, event_id, role)

    return event


async def pause_auction(event_id: int, db: AsyncSession) -> AuctionEvent:
    result = await db.execute(select(AuctionEvent).where(AuctionEvent.id == event_id))
    event = result.scalar_one_or_none()
    if not event or event.status != AuctionStatus.active:
        raise ValueError("Auction not active")

    # Stop timer
    task = _timer_tasks.pop(event_id, None)
    if task:
        task.cancel()

    redis = await get_redis()
    await redis.delete(_timer_key(event_id))

    event.status = AuctionStatus.paused
    await db.commit()
    await db.refresh(event)

    await manager.broadcast(event_id, {"type": "auction_paused", "event_id": event_id})
    return event


async def set_next_player(
    event_id: int,
    player_id: Optional[int],
    db: AsyncSession,
) -> AuctionPlayer:
    # Cancel any existing timer
    task = _timer_tasks.pop(event_id, None)
    if task:
        task.cancel()

    if player_id is None:
        # Random pending player
        result = await db.execute(
            select(AuctionPlayer).where(
                AuctionPlayer.event_id == event_id,
                AuctionPlayer.status == PlayerAuctionStatus.pending,
            )
        )
        pending = result.scalars().all()
        if not pending:
            raise ValueError("No pending players left")
        ap = random.choice(pending)
    else:
        result = await db.execute(
            select(AuctionPlayer).where(
                AuctionPlayer.id == player_id,
                AuctionPlayer.event_id == event_id,
            )
        )
        ap = result.scalar_one_or_none()
        if not ap:
            raise ValueError("Player not found in event")
        if ap.status != PlayerAuctionStatus.pending:
            raise ValueError("Player already auctioned")

    ap.status = PlayerAuctionStatus.active
    ap.current_bid = ap.base_price
    ap.current_bidder_id = None
    await db.commit()
    await db.refresh(ap)

    # Store active player in Redis and start timer
    redis = await get_redis()
    await redis.set(_active_key(event_id), ap.id)
    await redis.set(_timer_key(event_id), TIMER_SECONDS)

    await manager.broadcast(
        event_id,
        {
            "type": "player_up",
            "event_id": event_id,
            "auction_player_id": ap.id,
            "player_id": ap.player_id,
            "base_price": ap.base_price,
            "current_bid": ap.current_bid,
        },
    )

    # Start countdown in background
    task = asyncio.create_task(_run_timer(event_id, ap.id))
    _timer_tasks[event_id] = task

    return ap


async def _run_timer(event_id: int, auction_player_id: int):
    redis = await get_redis()
    try:
        for remaining in range(TIMER_SECONDS, -1, -1):
            await redis.set(_timer_key(event_id), remaining)
            await manager.broadcast(
                event_id,
                {"type": "timer_tick", "event_id": event_id, "remaining": remaining},
            )
            if remaining == 0:
                break
            await asyncio.sleep(1)

        # Auto-hammer when timer reaches 0
        from app.core.database import AsyncSessionLocal
        async with AsyncSessionLocal() as db:
            await hammer_player(event_id, auction_player_id, db)
    except asyncio.CancelledError:
        pass


async def place_bid(
    event_id: int,
    auction_player_id: int,
    captain_id: int,
    amount: int,
    db: AsyncSession,
) -> Bid:
    result = await db.execute(
        select(AuctionPlayer).where(
            AuctionPlayer.id == auction_player_id,
            AuctionPlayer.event_id == event_id,
        )
    )
    ap = result.scalar_one_or_none()
    if not ap or ap.status != PlayerAuctionStatus.active:
        raise ValueError("No active player to bid on")

    # Prevent captains from bidding on themselves
    if ap.player_id == captain_id:
        raise ValueError("You cannot bid on yourself")

    if amount <= ap.current_bid:
        raise ValueError(f"Bid must be higher than current bid ({ap.current_bid})")

    # Check captain's team budget
    team_result = await db.execute(
        select(Team).where(Team.event_id == event_id, Team.captain_id == captain_id)
    )
    team = team_result.scalar_one_or_none()
    if not team:
        raise ValueError("Captain has no team in this event")

    remaining_budget = team.budget - team.spent
    if amount > remaining_budget:
        raise ValueError(f"Insufficient budget. Remaining: {remaining_budget}")

    # Check roster capacity
    if len(team.players) >= team.max_players:
        raise ValueError("Team roster is full")

    ap.current_bid = amount
    ap.current_bidder_id = captain_id

    bid = Bid(
        event_id=event_id,
        auction_player_id=auction_player_id,
        captain_id=captain_id,
        amount=amount,
    )
    db.add(bid)
    await db.commit()
    await db.refresh(ap)

    # Reset timer
    redis = await get_redis()
    await redis.set(_timer_key(event_id), TIMER_SECONDS)

    await manager.broadcast(
        event_id,
        {
            "type": "new_bid",
            "event_id": event_id,
            "auction_player_id": auction_player_id,
            "captain_id": captain_id,
            "amount": amount,
            "current_bid": ap.current_bid,
        },
    )
    return bid


async def hammer_player(event_id: int, auction_player_id: int, db: AsyncSession):
    result = await db.execute(
        select(AuctionPlayer).where(AuctionPlayer.id == auction_player_id)
    )
    ap = result.scalar_one_or_none()
    if not ap or ap.status != PlayerAuctionStatus.active:
        return

    redis = await get_redis()
    await redis.delete(_timer_key(event_id))
    await redis.delete(_active_key(event_id))

    # Cancel timer task if manually hammered
    task = _timer_tasks.pop(event_id, None)
    if task and not task.done():
        task.cancel()

    if ap.current_bidder_id:
        ap.status = PlayerAuctionStatus.sold

        team_result = await db.execute(
            select(Team).where(
                Team.event_id == event_id,
                Team.captain_id == ap.current_bidder_id,
            )
        )
        team = team_result.scalar_one_or_none()
        if team:
            team.spent += ap.current_bid
            tp = TeamPlayer(team_id=team.id, player_id=ap.player_id, sold_price=ap.current_bid)
            db.add(tp)

            # Email captain about their new player
            cap_res = await db.execute(select(User).where(User.id == ap.current_bidder_id))
            captain = cap_res.scalar_one_or_none()
            player_res = await db.execute(select(User).where(User.id == ap.player_id))
            sold_player = player_res.scalar_one_or_none()
            if captain and sold_player:
                await enqueue(
                    "task_send_player_sold",
                    captain.email, captain.name, sold_player.name,
                    team.name, ap.current_bid, event_id,
                )

        await db.commit()
        await manager.broadcast(
            event_id,
            {
                "type": "player_sold",
                "event_id": event_id,
                "auction_player_id": ap.id,
                "player_id": ap.player_id,
                "sold_to_captain_id": ap.current_bidder_id,
                "sold_price": ap.current_bid,
            },
        )
    else:
        ap.status = PlayerAuctionStatus.unsold
        await db.commit()
        await manager.broadcast(
            event_id,
            {
                "type": "player_unsold",
                "event_id": event_id,
                "auction_player_id": ap.id,
                "player_id": ap.player_id,
            },
        )

    await db.refresh(ap)
    return ap
