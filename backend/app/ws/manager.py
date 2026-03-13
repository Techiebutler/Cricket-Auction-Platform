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
        # event_id -> dict of ws -> user_id (for tracking who is connected)
        self._user_map: dict[int, dict[WebSocket, int | None]] = defaultdict(dict)
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

    async def connect(self, event_id: int, ws: WebSocket, user_id: int | None = None):
        await ws.accept()
        self._rooms[event_id].append(ws)
        self._user_map[event_id][ws] = user_id
        
        # Track viewer in Redis
        await self._track_viewer_connect(event_id, user_id)

    async def disconnect(self, event_id: int, ws: WebSocket):
        user_id = self._user_map[event_id].pop(ws, None)
        
        if ws in self._rooms[event_id]:
            self._rooms[event_id].remove(ws)
        if not self._rooms[event_id]:
            if event_id in self._rooms:
                del self._rooms[event_id]
            if event_id in self._user_map:
                del self._user_map[event_id]
        
        # Update viewer count in Redis
        await self._track_viewer_disconnect(event_id, user_id)

    async def _track_viewer_connect(self, event_id: int, user_id: int | None):
        """Track viewer connection in Redis and broadcast updated count."""
        redis = await get_redis()
        
        # Increment live viewer count
        live_key = f"event:{event_id}:live_viewers"
        await redis.incr(live_key)
        
        # Add to unique viewers set (only if user is authenticated)
        if user_id:
            unique_key = f"event:{event_id}:unique_viewers"
            await redis.sadd(unique_key, str(user_id))
        
        # Broadcast updated viewer count
        await self._broadcast_viewer_count(event_id)

    async def _track_viewer_disconnect(self, event_id: int, user_id: int | None):
        """Track viewer disconnection and broadcast updated count."""
        redis = await get_redis()
        
        # Decrement live viewer count
        live_key = f"event:{event_id}:live_viewers"
        count = await redis.decr(live_key)
        
        # Ensure count doesn't go negative
        if count < 0:
            await redis.set(live_key, 0)
        
        # Broadcast updated viewer count
        await self._broadcast_viewer_count(event_id)

    async def _broadcast_viewer_count(self, event_id: int):
        """Broadcast current viewer count to all connected clients."""
        redis = await get_redis()
        live_key = f"event:{event_id}:live_viewers"
        count = await redis.get(live_key)
        viewer_count = int(count) if count else 0
        
        await self.broadcast(event_id, {
            "type": "viewer_count",
            "event_id": event_id,
            "count": viewer_count,
        })

    async def get_viewer_stats(self, event_id: int) -> dict:
        """Get live and total unique viewer counts for an event."""
        redis = await get_redis()
        
        live_key = f"event:{event_id}:live_viewers"
        unique_key = f"event:{event_id}:unique_viewers"
        
        live_count = await redis.get(live_key)
        unique_count = await redis.scard(unique_key)
        
        return {
            "live_viewers": int(live_count) if live_count else 0,
            "total_unique_viewers": unique_count or 0,
        }

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
