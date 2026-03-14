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
TIMER_SECONDS = 180

# Track running timer tasks per event (local to this worker)
_timer_tasks: dict[int, asyncio.Task] = {}


def _timer_owner_key(event_id: int) -> str:
    """Redis key to track which worker owns the timer."""
    return f"auction:{event_id}:timer_owner"


def _get_worker_id() -> str:
    """Get unique identifier for this worker process."""
    import os
    return f"{os.getpid()}"


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


async def get_auction_summary(event_id: int, db: AsyncSession) -> dict:
    """Build completed-auction summary used by UI and emails."""
    event_result = await db.execute(select(AuctionEvent).where(AuctionEvent.id == event_id))
    event = event_result.scalar_one_or_none()
    if not event:
        return {}

    teams_result = await db.execute(select(Team).where(Team.event_id == event_id))
    teams = teams_result.scalars().all()

    aps_result = await db.execute(select(AuctionPlayer).where(AuctionPlayer.event_id == event_id))
    auction_players = aps_result.scalars().all()

    player_ids: set[int] = {ap.player_id for ap in auction_players}
    for t in teams:
        player_ids.update(tp.player_id for tp in (t.players or []))
        if t.captain_id:
            player_ids.add(t.captain_id)

    users_by_id: dict[int, User] = {}
    if player_ids:
        users_result = await db.execute(select(User).where(User.id.in_(player_ids)))
        users = users_result.scalars().all()
        users_by_id = {u.id: u for u in users}

    sold_players = [ap for ap in auction_players if ap.status == PlayerAuctionStatus.sold]
    unsold_players = [ap for ap in auction_players if ap.status == PlayerAuctionStatus.unsold]

    highest_bid_player = None
    if sold_players:
        top = max(sold_players, key=lambda ap: ap.current_bid)
        top_team = next((t for t in teams if t.captain_id == top.current_bidder_id), None)
        highest_bid_player = {
            "player_id": top.player_id,
            "player_name": users_by_id.get(top.player_id).name if users_by_id.get(top.player_id) else f"Player #{top.player_id}",
            "sold_price": top.current_bid,
            "team_name": top_team.name if top_team else "Unknown Team",
        }

    teams_summary = []
    strongest_team = None
    best_rating = -1.0
    for t in teams:
        roster = []
        rating_total = 0.0
        batting_total = 0.0
        bowling_total = 0.0
        fielding_total = 0.0
        for tp in (t.players or []):
            pu = users_by_id.get(tp.player_id)
            batting = pu.batting_rating if pu else 0.0
            bowling = pu.bowling_rating if pu else 0.0
            fielding = pu.fielding_rating if pu else 0.0
            rating_score = batting + bowling + fielding
            rating_total += rating_score
            batting_total += batting
            bowling_total += bowling
            fielding_total += fielding
            roster.append(
                {
                    "player_id": tp.player_id,
                    "name": pu.name if pu else f"Player #{tp.player_id}",
                    "sold_price": tp.sold_price,
                    "rating_score": round(rating_score, 2),
                }
            )
        roster.sort(key=lambda x: x["sold_price"], reverse=True)
        players_count = len(roster)
        batting_avg = (batting_total / players_count) if players_count else 0.0
        bowling_avg = (bowling_total / players_count) if players_count else 0.0
        fielding_avg = (fielding_total / players_count) if players_count else 0.0
        overall_rating = (batting_avg + bowling_avg + fielding_avg) / 3 if players_count else 0.0
        summary_item = {
            "team_id": t.id,
            "team_name": t.name,
            "captain_id": t.captain_id,
            "captain_name": users_by_id.get(t.captain_id).name if t.captain_id and users_by_id.get(t.captain_id) else None,
            "spent": t.spent,
            "budget": t.budget,
            "remaining": t.budget - t.spent,
            "player_count": players_count,
            "average_rating": round(overall_rating, 2),
            "total_rating": round(rating_total, 2),
            "batting_avg": round(batting_avg, 2),
            "bowling_avg": round(bowling_avg, 2),
            "fielding_avg": round(fielding_avg, 2),
            "overall_rating": round(overall_rating, 2),
            "players": roster,
        }
        teams_summary.append(summary_item)
        if overall_rating > best_rating:
            best_rating = overall_rating
            strongest_team = {
                "team_id": t.id,
                "team_name": t.name,
                "overall_rating": round(overall_rating, 2),
                "batting_avg": round(batting_avg, 2),
                "bowling_avg": round(bowling_avg, 2),
                "fielding_avg": round(fielding_avg, 2),
                "player_count": players_count,
            }

    unsold_summary = [
        {
            "player_id": ap.player_id,
            "name": users_by_id.get(ap.player_id).name if users_by_id.get(ap.player_id) else f"Player #{ap.player_id}",
            "base_price": ap.base_price,
            "last_bid": ap.current_bid,
        }
        for ap in unsold_players
    ]

    # Get viewer stats - use persisted value for completed events
    if event.status == AuctionStatus.completed and event.total_viewers is not None:
        viewer_stats = {
            "live_viewers": 0,
            "total_unique_viewers": event.total_viewers,
        }
    else:
        from app.ws.manager import manager
        viewer_stats = await manager.get_viewer_stats(event_id)

    return {
        "event_id": event.id,
        "event_name": event.name,
        "status": event.status,
        "highest_bid_player": highest_bid_player,
        "strongest_team": strongest_team,
        "teams": teams_summary,
        "unsold_players": unsold_summary,
        "stats": {
            "total_players": len(auction_players),
            "sold_count": len(sold_players),
            "unsold_count": len(unsold_players),
        },
        "viewer_stats": viewer_stats,
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

    # Stop timer - clear ownership to signal all workers to stop
    redis = await get_redis()
    await redis.delete(_timer_owner_key(event_id))
    await redis.delete(_timer_key(event_id))
    
    # Cancel local timer task if we have one
    task = _timer_tasks.pop(event_id, None)
    if task and not task.done():
        task.cancel()

    event.status = AuctionStatus.paused
    await db.commit()
    await db.refresh(event)

    await manager.broadcast(event_id, {"type": "auction_paused", "event_id": event_id})
    return event


async def finish_auction(event_id: int, db: AsyncSession) -> AuctionEvent:
    result = await db.execute(select(AuctionEvent).where(AuctionEvent.id == event_id))
    event = result.scalar_one_or_none()
    if not event or event.status not in (AuctionStatus.active, AuctionStatus.paused):
        raise ValueError("Auction must be active or paused to finish")

    # Stop timer - clear ownership to signal all workers to stop
    redis = await get_redis()
    await redis.delete(_timer_owner_key(event_id))
    await redis.delete(_timer_key(event_id))
    await redis.delete(_active_key(event_id))
    
    # Cancel local timer task if we have one
    task = _timer_tasks.pop(event_id, None)
    if task and not task.done():
        task.cancel()

    # Mark active players as unsold
    active_players_res = await db.execute(
        select(AuctionPlayer).where(
            AuctionPlayer.event_id == event_id,
            AuctionPlayer.status == PlayerAuctionStatus.active
        )
    )
    for ap in active_players_res.scalars().all():
        ap.status = PlayerAuctionStatus.unsold

    # Persist final viewer count before marking as completed
    viewer_stats = await manager.get_viewer_stats(event_id)
    event.total_viewers = viewer_stats.get("total_unique_viewers", 0)
    
    event.status = AuctionStatus.completed
    await db.commit()
    await db.refresh(event)
    
    # Set expiration on Redis viewer keys (7 days) - data is now persisted in DB
    redis = await get_redis()
    await redis.expire(f"event:{event_id}:unique_viewers", 86400 * 7)
    await redis.expire(f"event:{event_id}:live_sessions", 86400 * 7)

    summary = await get_auction_summary(event_id, db)

    # Email completion summary to all event participants.
    participant_ids: set[int] = set()
    teams_result = await db.execute(select(Team).where(Team.event_id == event_id))
    teams = teams_result.scalars().all()
    participant_ids.update(t.captain_id for t in teams if t.captain_id is not None)

    aps_result = await db.execute(select(AuctionPlayer).where(AuctionPlayer.event_id == event_id))
    participant_ids.update(ap.player_id for ap in aps_result.scalars().all())

    if event.auctioneer_id:
        participant_ids.add(event.auctioneer_id)
    if event.organizer_id:
        participant_ids.add(event.organizer_id)
    if event.admin_id:
        participant_ids.add(event.admin_id)

    if participant_ids:
        users_result = await db.execute(select(User).where(User.id.in_(participant_ids)))
        for u in users_result.scalars().all():
            await enqueue(
                "task_send_event_completion_summary",
                u.email,
                u.name,
                event.name,
                event_id,
                summary,
            )

    await manager.broadcast(event_id, {"type": "auction_completed", "event_id": event_id})
    return event


async def set_next_player(
    event_id: int,
    player_id: Optional[int],
    db: AsyncSession,
) -> AuctionPlayer:
    # Take over timer ownership via Redis to stop any running timers on other workers
    redis = await get_redis()
    worker_id = _get_worker_id()
    owner_key = _timer_owner_key(event_id)
    
    # Take ownership - this signals other workers to stop their timers
    await redis.set(owner_key, worker_id)
    
    # Cancel local timer task if we have one
    task = _timer_tasks.pop(event_id, None)
    if task and not task.done():
        task.cancel()
        try:
            await asyncio.wait_for(asyncio.shield(task), timeout=0.1)
        except (asyncio.CancelledError, asyncio.TimeoutError):
            pass

    # Defensive normalization: if any stale rows are still marked active
    # (e.g. from old runs/crashes), mark them unsold before moving next.
    stale_active_res = await db.execute(
        select(AuctionPlayer).where(
            AuctionPlayer.event_id == event_id,
            AuctionPlayer.status == PlayerAuctionStatus.active,
        )
    )
    for stale in stale_active_res.scalars().all():
        stale.status = PlayerAuctionStatus.unsold

    teams_result = await db.execute(select(Team).where(Team.event_id == event_id))
    captain_ids = {t.captain_id for t in teams_result.scalars().all() if t.captain_id is not None}

    if player_id is None:
        # Random pending player
        result = await db.execute(
            select(AuctionPlayer).where(
                AuctionPlayer.event_id == event_id,
                AuctionPlayer.status == PlayerAuctionStatus.pending,
            )
        )
        pending = [p for p in result.scalars().all() if p.player_id not in captain_ids]
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
        if ap.player_id in captain_ids:
            raise ValueError("Team captains cannot be auctioned")
        # Allow re-auctioning unsold players
        if ap.status not in (PlayerAuctionStatus.pending, PlayerAuctionStatus.unsold):
            raise ValueError("Player already auctioned")

    ap.status = PlayerAuctionStatus.active
    ap.current_bid = ap.base_price
    ap.current_bidder_id = None
    await db.commit()
    await db.refresh(ap)

    # Store active player in Redis and start timer
    # redis already fetched at start of function
    await redis.set(_active_key(event_id), ap.id)
    await redis.set(_timer_key(event_id), TIMER_SECONDS)
    
    # Start countdown in background on this worker
    task = asyncio.create_task(_run_timer(event_id, ap.id))
    _timer_tasks[event_id] = task

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

    return ap


async def _run_timer(event_id: int, auction_player_id: int):
    """
    Run the countdown timer. Uses Redis to coordinate across workers.
    Only the worker that owns the timer will run the countdown.
    """
    redis = await get_redis()
    worker_id = _get_worker_id()
    owner_key = _timer_owner_key(event_id)
    
    try:
        for remaining in range(TIMER_SECONDS, -1, -1):
            # Check if we still own the timer (another worker may have taken over)
            current_owner = await redis.get(owner_key)
            if current_owner != worker_id:
                # Another worker has taken over, stop this timer
                return
            
            await redis.set(_timer_key(event_id), remaining)
            await manager.broadcast(
                event_id,
                {"type": "timer_tick", "event_id": event_id, "remaining": remaining},
            )
            if remaining == 0:
                break
            await asyncio.sleep(1)

        # Auto-hammer when timer reaches 0 - but only if we still own it
        # Use atomic check-and-delete to prevent race conditions
        current_owner = await redis.get(owner_key)
        if current_owner == worker_id:
            # Delete ownership BEFORE hammering to prevent other workers from
            # thinking we still own it during the hammer operation
            await redis.delete(owner_key)
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

    # Enforce turn-based bidding: same team/captain cannot bid twice in a row.
    if ap.current_bidder_id == captain_id:
        raise ValueError("Wait for another team to bid before bidding again")

    if amount <= ap.current_bid:
        raise ValueError(f"Bid must be higher than current bid ({ap.current_bid})")

    # Tiered minimum bid increment based on current bid
    # >= 100000 => step 10000
    # >= 10000  => step 1000
    # >= 1000   => step 100
    # < 1000    => step 50
    if ap.current_bid >= 100000:
        min_step = 10000
    elif ap.current_bid >= 10000:
        min_step = 1000
    elif ap.current_bid >= 1000:
        min_step = 100
    else:
        min_step = 50

    increment = amount - ap.current_bid
    if increment < min_step:
        raise ValueError(
            f"Minimum increment is {min_step}"
        )
    if increment % min_step != 0:
        raise ValueError(
            f"Bid increment must be in multiples of {min_step}"
        )

    # Check captain's team budget first (needed for max bid calculation)
    team_result = await db.execute(
        select(Team).where(Team.event_id == event_id, Team.captain_id == captain_id)
    )
    team = team_result.scalar_one_or_none()
    if not team:
        raise ValueError("Captain has no team in this event")

    # Guard against unrealistic jump bids:
    # Max increment is min(50% of current bid, 5% of total budget)
    fifty_percent_increment = ap.current_bid // 2
    five_percent_of_budget = team.budget // 20  # 5% of budget
    max_increment = min(fifty_percent_increment, five_percent_of_budget)
    max_allowed_bid = ap.current_bid + max_increment
    
    if amount > max_allowed_bid:
        if five_percent_of_budget < fifty_percent_increment:
            raise ValueError(f"Max increment is 5% of budget. Max allowed: {max_allowed_bid}")
        else:
            raise ValueError(f"Max increment is 50% of current bid. Max allowed: {max_allowed_bid}")

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

    # Reset timer to full duration on every valid bid.
    # Take over timer ownership via Redis to coordinate across workers.
    redis = await get_redis()
    worker_id = _get_worker_id()
    owner_key = _timer_owner_key(event_id)
    
    # Take ownership - this signals other workers to stop their timers
    await redis.set(owner_key, worker_id)
    await redis.set(_timer_key(event_id), TIMER_SECONDS)
    
    # Cancel local timer task if we have one
    task = _timer_tasks.pop(event_id, None)
    if task and not task.done():
        task.cancel()
        try:
            await asyncio.wait_for(asyncio.shield(task), timeout=0.1)
        except (asyncio.CancelledError, asyncio.TimeoutError):
            pass

    # Start new timer on this worker
    task = asyncio.create_task(_run_timer(event_id, auction_player_id))
    _timer_tasks[event_id] = task

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

    # Clear timer ownership and keys - signals all workers to stop their timers
    redis = await get_redis()
    await redis.delete(_timer_owner_key(event_id))
    await redis.delete(_timer_key(event_id))
    await redis.delete(_active_key(event_id))

    # Cancel local timer task if we have one (and it's not the current task doing auto-hammer)
    task = _timer_tasks.pop(event_id, None)
    current = asyncio.current_task()
    if task and not task.done() and task is not current:
        task.cancel()
        try:
            await asyncio.wait_for(asyncio.shield(task), timeout=0.1)
        except (asyncio.CancelledError, asyncio.TimeoutError):
            pass

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
