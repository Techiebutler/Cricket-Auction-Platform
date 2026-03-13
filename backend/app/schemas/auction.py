from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from app.models.auction import AuctionStatus, PlayerAuctionStatus


class AuctionEventCreate(BaseModel):
    name: str
    description: Optional[str] = None
    allowed_domains: list[str] = []
    scheduled_at: Optional[datetime] = None


class AuctionEventUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    organizer_id: Optional[int] = None
    auctioneer_id: Optional[int] = None
    allowed_domains: Optional[list[str]] = None
    scheduled_at: Optional[datetime] = None
    team_budget: Optional[int] = Field(default=None, ge=1000)
    team_max_players: Optional[int] = None
    player_base_price: Optional[int] = Field(default=None, ge=100)


class AuctionEventOut(BaseModel):
    id: int
    name: str
    description: Optional[str]
    admin_id: int
    organizer_id: Optional[int]
    auctioneer_id: Optional[int]
    status: AuctionStatus
    allowed_domains: list[str]
    scheduled_at: Optional[datetime]
    team_budget: int
    team_max_players: int
    player_base_price: int
    created_at: datetime

    model_config = {"from_attributes": True}


class TeamCreate(BaseModel):
    name: str
    color: str = "#3B82F6"
    budget: int = 1000
    max_players: int = 11


class TeamUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    captain_id: Optional[int] = None
    budget: Optional[int] = None
    max_players: Optional[int] = None


class TeamPlayerOut(BaseModel):
    id: int
    team_id: int
    player_id: int
    sold_price: int

    model_config = {"from_attributes": True}


class TeamOut(BaseModel):
    id: int
    event_id: int
    name: str
    color: str
    captain_id: Optional[int]
    budget: int
    spent: int
    max_players: int
    players: list[TeamPlayerOut] = []

    model_config = {"from_attributes": True}


class AuctionPlayerCreate(BaseModel):
    player_id: int
    base_price: int | None = None


class AuctionPlayerOut(BaseModel):
    id: int
    event_id: int
    player_id: int
    base_price: int
    current_bid: int
    current_bidder_id: Optional[int]
    status: PlayerAuctionStatus
    auction_order: int

    model_config = {"from_attributes": True}


class BidCreate(BaseModel):
    amount: int


class BidOut(BaseModel):
    id: int
    event_id: int
    auction_player_id: int
    captain_id: int
    amount: int
    created_at: datetime

    model_config = {"from_attributes": True}


class NextPlayerRequest(BaseModel):
    player_id: Optional[int] = None  # None = random
