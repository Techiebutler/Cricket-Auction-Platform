import asyncio
import json
from collections import defaultdict
from typing import Any

from fastapi import WebSocket

from app.core.redis import get_redis


class ConnectionManager:
    def __init__(self):
        # event_id -> list of WebSocket connections
        self._rooms: dict[int, list[WebSocket]] = defaultdict(list)
        self._pubsub = None
        self._task: asyncio.Task | None = None

    async def startup(self):
        redis = await get_redis()
        self._pubsub = redis.pubsub()
        await self._pubsub.subscribe("auction_events_channel")
        self._task = asyncio.create_task(self._listen())

    async def shutdown(self):
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        if self._pubsub:
            await self._pubsub.unsubscribe("auction_events_channel")
            await self._pubsub.close()

    async def _listen(self):
        try:
            async for message in self._pubsub.listen():
                if message["type"] == "message":
                    data = json.loads(message["data"])
                    event_id = data.get("event_id")
                    payload = data.get("payload")
                    if event_id is not None and payload is not None:
                        await self._local_broadcast(event_id, payload)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            print(f"Redis pubsub error: {e}")

    async def connect(self, event_id: int, ws: WebSocket):
        await ws.accept()
        self._rooms[event_id].append(ws)

    def disconnect(self, event_id: int, ws: WebSocket):
        if ws in self._rooms[event_id]:
            self._rooms[event_id].remove(ws)
        if not self._rooms[event_id]:
            if event_id in self._rooms:
                del self._rooms[event_id]

    async def broadcast(self, event_id: int, message: dict[str, Any]):
        # Instead of sending directly, publish to Redis so ALL workers receive it
        redis = await get_redis()
        payload = {
            "event_id": event_id,
            "payload": message
        }
        await redis.publish("auction_events_channel", json.dumps(payload))

    async def _local_broadcast(self, event_id: int, message: dict[str, Any]):
        # Send to WebSockets connected to this specific worker process
        payload = json.dumps(message)
        dead = []
        for ws in list(self._rooms.get(event_id, [])):
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            try:
                self._rooms[event_id].remove(ws)
            except ValueError:
                pass

    async def send_personal(self, ws: WebSocket, message: dict[str, Any]):
        await ws.send_text(json.dumps(message))


manager = ConnectionManager()
