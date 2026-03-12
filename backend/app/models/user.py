from datetime import datetime, timezone

from sqlalchemy import String, Float, DateTime, ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

# Role constants - used as string values stored in the roles array
ROLE_ADMIN = "admin"
ROLE_ORGANIZER = "organizer"
ROLE_AUCTIONEER = "auctioneer"
ROLE_CAPTAIN = "captain"
ROLE_PLAYER = "player"

ALL_ROLES = {ROLE_ADMIN, ROLE_ORGANIZER, ROLE_AUCTIONEER, ROLE_CAPTAIN, ROLE_PLAYER}


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    hashed_password: Mapped[str] = mapped_column(String(255))

    # Multiple roles: e.g. ["admin", "player"] or ["captain", "organizer", "player"]
    roles: Mapped[list[str]] = mapped_column(ARRAY(String), default=lambda: [ROLE_PLAYER])

    profile_photo: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Cricket ratings (1-10)
    batting_rating: Mapped[float] = mapped_column(Float, default=5.0)
    bowling_rating: Mapped[float] = mapped_column(Float, default=5.0)
    fielding_rating: Mapped[float] = mapped_column(Float, default=5.0)

    is_active: Mapped[bool] = mapped_column(default=True)
    onboarded: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    def has_role(self, role: str) -> bool:
        return role in (self.roles or [ROLE_PLAYER])

    def add_role(self, role: str):
        current = list(self.roles or [ROLE_PLAYER])
        if role not in current:
            current.append(role)
        self.roles = current

    def remove_role(self, role: str):
        current = list(self.roles or [ROLE_PLAYER])
        self.roles = [r for r in current if r != role]
