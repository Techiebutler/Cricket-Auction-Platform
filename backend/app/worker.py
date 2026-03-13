"""
ARQ background worker.
Uses the existing Redis instance — no extra infrastructure needed.

Tasks defined here are enqueued by the API and executed by the worker process.
"""
from arq.connections import RedisSettings

from app.core.config import settings
from app.services import email_service


# ─── Email tasks ──────────────────────────────────────────────────────────────

async def task_send_event_invitation(
    ctx: dict,
    to: str,
    name: str,
    event_name: str,
    event_id: int,
    role: str,
):
    email_service.send_event_invitation(to, name, event_name, event_id, role)


async def task_send_organizer_invite(
    ctx: dict,
    to: str,
    event_name: str,
    token: str,
    role: str,
):
    email_service.send_organizer_invite(to, event_name, token, role)


async def task_send_magic_code(ctx: dict, to: str, name: str, code: str):
    email_service.send_magic_code(to, name, code)


async def task_send_welcome(ctx: dict, to: str, name: str):
    email_service.send_welcome(to, name)


async def task_send_auction_starting(
    ctx: dict,
    to: str,
    name: str,
    event_name: str,
    event_id: int,
    role: str,
):
    email_service.send_auction_starting(to, name, event_name, event_id, role)


async def task_send_player_sold(
    ctx: dict,
    to: str,
    captain_name: str,
    player_name: str,
    team_name: str,
    sold_price: int,
    event_id: int,
):
    email_service.send_player_sold(to, captain_name, player_name, team_name, sold_price, event_id)


async def task_send_event_completion_summary(
    ctx: dict,
    to: str,
    name: str,
    event_name: str,
    event_id: int,
    summary: dict,
):
    email_service.send_event_completion_summary(to, name, event_name, event_id, summary)


# ─── Worker configuration ─────────────────────────────────────────────────────

class WorkerSettings:
    functions = [
        task_send_event_invitation,
        task_send_organizer_invite,
        task_send_magic_code,
        task_send_welcome,
        task_send_auction_starting,
        task_send_player_sold,
        task_send_event_completion_summary,
    ]
    redis_settings = RedisSettings.from_dsn(settings.REDIS_URL)
    max_jobs = 10
    job_timeout = 30  # seconds per job
    keep_result = 300  # keep job results for 5 minutes
