import enum
from datetime import datetime, timezone

from sqlalchemy import String, Enum, Integer, ForeignKey, Float, DateTime, ARRAY, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class AuctionStatus(str, enum.Enum):
    draft = "draft"
    ready = "ready"
    active = "active"
    paused = "paused"
    completed = "completed"


class PlayerAuctionStatus(str, enum.Enum):
    pending = "pending"
    active = "active"
    sold = "sold"
    unsold = "unsold"


class AuctionEvent(Base):
    __tablename__ = "auction_events"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    admin_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    organizer_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    auctioneer_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    status: Mapped[AuctionStatus] = mapped_column(Enum(AuctionStatus, name="auctionstatus", create_type=False), default=AuctionStatus.draft)
    allowed_domains: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    
    # Global budget and max players per team
    team_budget: Mapped[int] = mapped_column(Integer, default=100000)
    team_max_players: Mapped[int] = mapped_column(Integer, default=15)
    
    # Global player base price
    player_base_price: Mapped[int] = mapped_column(Integer, default=100)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    teams: Mapped[list["Team"]] = relationship("Team", back_populates="event", lazy="selectin")
    auction_players: Mapped[list["AuctionPlayer"]] = relationship(
        "AuctionPlayer", back_populates="event", lazy="selectin"
    )


class Team(Base):
    __tablename__ = "teams"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("auction_events.id"))
    name: Mapped[str] = mapped_column(String(100))
    color: Mapped[str] = mapped_column(String(7), default="#3B82F6")  # hex color
    captain_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    budget: Mapped[int] = mapped_column(Integer, default=1000)
    spent: Mapped[int] = mapped_column(Integer, default=0)
    max_players: Mapped[int] = mapped_column(Integer, default=11)

    event: Mapped["AuctionEvent"] = relationship("AuctionEvent", back_populates="teams")
    players: Mapped[list["TeamPlayer"]] = relationship("TeamPlayer", back_populates="team", lazy="selectin")


class TeamPlayer(Base):
    __tablename__ = "team_players"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"))
    player_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    sold_price: Mapped[int] = mapped_column(Integer, default=0)

    team: Mapped["Team"] = relationship("Team", back_populates="players")


class AuctionPlayer(Base):
    __tablename__ = "auction_players"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("auction_events.id"))
    player_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    base_price: Mapped[int] = mapped_column(Integer, default=100)
    current_bid: Mapped[int] = mapped_column(Integer, default=0)
    current_bidder_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    status: Mapped[PlayerAuctionStatus] = mapped_column(Enum(PlayerAuctionStatus, name="playerauctionstatus", create_type=False), default=PlayerAuctionStatus.pending)
    auction_order: Mapped[int] = mapped_column(Integer, default=0)

    event: Mapped["AuctionEvent"] = relationship("AuctionEvent", back_populates="auction_players")


class Bid(Base):
    __tablename__ = "bids"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("auction_events.id"))
    auction_player_id: Mapped[int] = mapped_column(ForeignKey("auction_players.id"))
    captain_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    amount: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
