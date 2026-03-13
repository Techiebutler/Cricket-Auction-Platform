import asyncio
from app.core.database import AsyncSessionLocal
from sqlalchemy import select
from app.models.auction import AuctionEvent, Team, AuctionPlayer, TeamPlayer, PlayerAuctionStatus

async def fix():
    async with AsyncSessionLocal() as db:
        events_res = await db.execute(select(AuctionEvent))
        events = events_res.scalars().all()
        for event in events:
            teams_res = await db.execute(select(Team).where(Team.event_id == event.id))
            teams = teams_res.scalars().all()
            for team in teams:
                if team.captain_id:
                    # Check if captain is in TeamPlayer
                    tp_res = await db.execute(select(TeamPlayer).where(
                        TeamPlayer.team_id == team.id,
                        TeamPlayer.player_id == team.captain_id
                    ))
                    if not tp_res.scalar_one_or_none():
                        tp = TeamPlayer(team_id=team.id, player_id=team.captain_id, sold_price=0)
                        db.add(tp)
                    
                    # Check if captain is in AuctionPlayer
                    ap_res = await db.execute(select(AuctionPlayer).where(
                        AuctionPlayer.event_id == event.id,
                        AuctionPlayer.player_id == team.captain_id
                    ))
                    ap = ap_res.scalar_one_or_none()
                    if ap:
                        ap.status = PlayerAuctionStatus.sold
                        ap.current_bidder_id = team.captain_id
                        ap.current_bid = 0
                    else:
                        ap = AuctionPlayer(
                            event_id=event.id,
                            player_id=team.captain_id,
                            base_price=event.player_base_price or 100,
                            status=PlayerAuctionStatus.sold,
                            current_bid=0,
                            current_bidder_id=team.captain_id,
                            auction_order=0
                        )
                        db.add(ap)

        await db.commit()
        print("Done syncing captains!")

if __name__ == "__main__":
    asyncio.run(fix())
