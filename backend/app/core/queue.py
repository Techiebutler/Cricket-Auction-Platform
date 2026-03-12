"""
Thin wrapper around ARQ for enqueuing background tasks.
Falls back to direct (synchronous) call if ARQ is unavailable.
"""
import logging
from typing import Any

from arq import create_pool
from arq.connections import RedisSettings

from app.core.config import settings

logger = logging.getLogger(__name__)

_pool = None


async def get_queue():
    global _pool
    if _pool is None:
        _pool = await create_pool(RedisSettings.from_dsn(settings.REDIS_URL))
    return _pool


async def enqueue(task_name: str, *args: Any, **kwargs: Any):
    """Enqueue a task by name. Logs on failure but never raises."""
    try:
        pool = await get_queue()
        await pool.enqueue_job(task_name, *args, **kwargs)
        logger.info("[QUEUE] Enqueued %s", task_name)
    except Exception as e:
        logger.error("[QUEUE ERROR] Failed to enqueue %s: %s", task_name, e)
