import secrets
import json

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_

from app.core.database import get_db
from app.core.deps import get_current_user, require_role
from app.core.redis import get_redis
from app.models.user import User, ROLE_ADMIN, ROLE_ORGANIZER, ROLE_AUCTIONEER
from app.models.auction import AuctionEvent, AuctionStatus
from app.schemas.auction import AuctionEventCreate, AuctionEventUpdate, AuctionEventOut
from app.schemas.user import UserOut, AssignRolePayload
from app.services import email_service
from app.core.queue import enqueue
from pydantic import BaseModel, EmailStr, field_validator

INVITE_TTL_SECONDS = 60 * 60 * 24 * 7  # 7 days


class InvitePayload(BaseModel):
    email: EmailStr
    role: str  # "organizer" | "auctioneer"

    @field_validator("email")
    @classmethod
    def lowercase_email(cls, v: str) -> str:
        return v.lower()

router = APIRouter(prefix="/admin", tags=["admin"])


@router.post("/events", response_model=AuctionEventOut, status_code=201)
async def create_event(
    payload: AuctionEventCreate,
    current_user: User = Depends(require_role(ROLE_ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    event = AuctionEvent(
        name=payload.name,
        description=payload.description,
        admin_id=current_user.id,
        allowed_domains=payload.allowed_domains,
        scheduled_at=payload.scheduled_at,
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return AuctionEventOut.model_validate(event)


@router.get("/events", response_model=list[AuctionEventOut])
async def list_events(
    current_user: User = Depends(require_role(ROLE_ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(AuctionEvent).where(AuctionEvent.admin_id == current_user.id))
    return [AuctionEventOut.model_validate(e) for e in result.scalars().all()]


@router.get("/events/{event_id}", response_model=AuctionEventOut)
async def get_event(
    event_id: int,
    current_user: User = Depends(require_role(ROLE_ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(AuctionEvent).where(AuctionEvent.id == event_id))
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return AuctionEventOut.model_validate(event)


@router.patch("/events/{event_id}", response_model=AuctionEventOut)
async def update_event(
    event_id: int,
    payload: AuctionEventUpdate,
    current_user: User = Depends(require_role(ROLE_ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(AuctionEvent).where(AuctionEvent.id == event_id))
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
        
    if event.status == AuctionStatus.completed:
        raise HTTPException(status_code=400, detail="Cannot edit a completed event")

    if payload.name is not None:
        event.name = payload.name
    if payload.description is not None:
        event.description = payload.description
    if payload.organizer_id is not None:
        event.organizer_id = payload.organizer_id
        # Auto-grant organizer role to the assigned user
        org_result = await db.execute(select(User).where(User.id == payload.organizer_id))
        org_user = org_result.scalar_one_or_none()
        if org_user:
            org_user.add_role("organizer")
    if payload.auctioneer_id is not None:
        event.auctioneer_id = payload.auctioneer_id
        # Auto-grant auctioneer role
        ae_result = await db.execute(select(User).where(User.id == payload.auctioneer_id))
        ae_user = ae_result.scalar_one_or_none()
        if ae_user:
            ae_user.add_role("auctioneer")
    if payload.allowed_domains is not None:
        event.allowed_domains = payload.allowed_domains
    if payload.scheduled_at is not None:
        event.scheduled_at = payload.scheduled_at

    await db.commit()
    await db.refresh(event)
    return AuctionEventOut.model_validate(event)


@router.get("/users", response_model=list[UserOut])
async def list_users(
    current_user: User = Depends(require_role(ROLE_ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User))
    return [UserOut.model_validate(u) for u in result.scalars().all()]


@router.get("/users/search", response_model=list[UserOut])
async def search_users(
    q: str = Query(..., min_length=1),
    current_user: User = Depends(require_role(ROLE_ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    """Search users by name or email — used by the invite widget."""
    pattern = f"%{q}%"
    result = await db.execute(
        select(User).where(
            or_(User.name.ilike(pattern), User.email.ilike(pattern))
        ).limit(8)
    )
    return [UserOut.model_validate(u) for u in result.scalars().all()]


@router.post("/events/{event_id}/invite", response_model=dict)
async def invite_to_event(
    event_id: int,
    payload: InvitePayload,
    current_user: User = Depends(require_role(ROLE_ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    """
    Invite someone to an event as organizer/auctioneer.
    - If the email already has an account → assign role immediately.
    - If not → send an invite email with a one-time token link.
    """
    if payload.role not in (ROLE_ORGANIZER, ROLE_AUCTIONEER):
        raise HTTPException(status_code=400, detail="Role must be organizer or auctioneer")

    ev_result = await db.execute(select(AuctionEvent).where(AuctionEvent.id == event_id))
    event = ev_result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    user_result = await db.execute(select(User).where(User.email == payload.email))
    user = user_result.scalar_one_or_none()

    if user:
        # Existing user → assign immediately
        user.add_role(payload.role)
        if payload.role == ROLE_ORGANIZER:
            event.organizer_id = user.id
        else:
            event.auctioneer_id = user.id
        await db.commit()
        await db.refresh(user)
        email_service.send_event_invitation(user.email, user.name, event.name, event.id, payload.role)
        return {
            "status": "assigned",
            "user": UserOut.model_validate(user).model_dump(),
            "message": f"{user.name} assigned as {payload.role}",
        }
    else:
        # Unknown email → create invite token in Redis
        token = secrets.token_urlsafe(32)
        redis = await get_redis()
        invite_data = {
            "email": payload.email,
            "event_id": event_id,
            "event_name": event.name,
            "role": payload.role,
        }
        await redis.setex(f"invite:{token}", INVITE_TTL_SECONDS, json.dumps(invite_data))
        await enqueue("task_send_organizer_invite", payload.email, event.name, token, payload.role)
        return {
            "status": "invited",
            "user": None,
            "message": f"Invitation sent to {payload.email}",
        }


@router.post("/users/{user_id}/roles/add", response_model=UserOut)
async def add_user_role(
    user_id: int,
    payload: AssignRolePayload,
    current_user: User = Depends(require_role(ROLE_ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.add_role(payload.role)
    await db.commit()
    await db.refresh(user)
    return UserOut.model_validate(user)


@router.post("/users/{user_id}/roles/remove", response_model=UserOut)
async def remove_user_role(
    user_id: int,
    payload: AssignRolePayload,
    current_user: User = Depends(require_role(ROLE_ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if payload.role == "player":
        raise HTTPException(status_code=400, detail="Cannot remove the base player role")
    user.remove_role(payload.role)
    await db.commit()
    await db.refresh(user)
    return UserOut.model_validate(user)
