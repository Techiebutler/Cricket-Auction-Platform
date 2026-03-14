from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, field_validator

from app.models.user import ALL_ROLES


class UserRegister(BaseModel):
    name: str
    email: EmailStr
    password: str

    @field_validator("email")
    @classmethod
    def lowercase_email(cls, v: str) -> str:
        return v.lower()


class GodmodeRegister(BaseModel):
    name: str
    email: EmailStr
    password: str
    secret: str  # must match GODMODE_SECRET

    @field_validator("email")
    @classmethod
    def lowercase_email(cls, v: str) -> str:
        return v.lower()


class UserLogin(BaseModel):
    email: EmailStr
    password: str

    @field_validator("email")
    @classmethod
    def lowercase_email(cls, v: str) -> str:
        return v.lower()


class UserOnboard(BaseModel):
    phone: Optional[str] = None
    batting_rating: float = 5.0
    bowling_rating: float = 5.0
    fielding_rating: float = 5.0


class UserOut(BaseModel):
    id: int
    name: str
    email: str
    phone: Optional[str]
    roles: list[str]
    profile_photo: Optional[str]
    batting_rating: float
    bowling_rating: float
    fielding_rating: float
    onboarded: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class AssignRolePayload(BaseModel):
    role: str

    def model_post_init(self, __context):
        if self.role not in ALL_ROLES:
            raise ValueError(f"Invalid role. Must be one of: {list(ALL_ROLES)}")
