import asyncio
import json
import time
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
        # ws -> session_id (for tracking Redis session per connection)
        self._ws_sessions: dict[WebSocket, str] = {}
        self._pubsub = None
        self._task: asyncio.Task | None = None
        self._cleanup_task: asyncio.Task | None = None
        # Debounce tracking for viewer count broadcasts
        self._pending_broadcasts: dict[int, asyncio.Task | None] = {}
        self._last_broadcast_time: dict[int, float] = {}

    async def startup(self):
        redis = await get_redis()
        self._pubsub = redis.pubsub()
        await self._pubsub.subscribe("auction_events_channel")
        self._task = asyncio.create_task(self._listen())
        self._cleanup_task = asyncio.create_task(self._periodic_cleanup())

    async def shutdown(self):
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        if self._cleanup_task:
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
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
        await self._track_viewer_connect(event_id, ws, user_id)

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
        await self._track_viewer_disconnect(event_id, ws)

    async def _track_viewer_connect(self, event_id: int, ws: WebSocket, user_id: int | None):
        """Track viewer connection in Redis and broadcast updated count."""
        redis = await get_redis()
        
        # Use a set to track connected sessions (more reliable than counter)
        # Each WebSocket connection gets a unique session ID
        session_key = f"event:{event_id}:live_sessions"
        session_id = f"{id(ws)}:{time.time()}"
        await redis.sadd(session_key, session_id)
        
        # Store session_id for this WebSocket to remove on disconnect
        self._ws_sessions[ws] = session_id
        
        # Add to unique viewers set (only if user is authenticated)
        if user_id:
            unique_key = f"event:{event_id}:unique_viewers"
            await redis.sadd(unique_key, str(user_id))
        
        # Broadcast updated viewer count
        await self._broadcast_viewer_count(event_id)

    async def _track_viewer_disconnect(self, event_id: int, ws: WebSocket):
        """Track viewer disconnection and broadcast updated count."""
        redis = await get_redis()
        
        # Remove session from live sessions set
        session_key = f"event:{event_id}:live_sessions"
        session_id = self._ws_sessions.pop(ws, None)
        if session_id:
            await redis.srem(session_key, session_id)
        
        # Broadcast updated viewer count
        await self._broadcast_viewer_count(event_id)

    async def _broadcast_viewer_count(self, event_id: int):
        """
        Broadcast current viewer count to all connected clients.
        Debounced to max 1 broadcast per 5 seconds per event.
        """
        DEBOUNCE_SECONDS = 5
        
        current_time = time.time()
        last_broadcast = self._last_broadcast_time.get(event_id, 0)
        
        # If we broadcasted recently, schedule a delayed broadcast instead
        if current_time - last_broadcast < DEBOUNCE_SECONDS:
            # Cancel any existing pending broadcast for this event
            existing_task = self._pending_broadcasts.get(event_id)
            if existing_task and not existing_task.done():
                existing_task.cancel()
            
            # Schedule a new broadcast after the remaining debounce time
            delay = DEBOUNCE_SECONDS - (current_time - last_broadcast)
            self._pending_broadcasts[event_id] = asyncio.create_task(
                self._delayed_broadcast(event_id, delay)
            )
            return
        
        # Broadcast immediately
        await self._do_broadcast_viewer_count(event_id)
    
    async def _delayed_broadcast(self, event_id: int, delay: float):
        """Helper to broadcast after a delay."""
        try:
            await asyncio.sleep(delay)
            await self._do_broadcast_viewer_count(event_id)
        except asyncio.CancelledError:
            pass
    
    async def _do_broadcast_viewer_count(self, event_id: int):
        """Actually perform the viewer count broadcast."""
        redis = await get_redis()
        session_key = f"event:{event_id}:live_sessions"
        viewer_count = await redis.scard(session_key) or 0
        
        self._last_broadcast_time[event_id] = time.time()
        
        await self.broadcast(event_id, {
            "type": "viewer_count",
            "event_id": event_id,
            "count": viewer_count,
        })

    async def get_viewer_stats(self, event_id: int) -> dict:
        """Get live and total unique viewer counts for an event."""
        redis = await get_redis()
        
        session_key = f"event:{event_id}:live_sessions"
        unique_key = f"event:{event_id}:unique_viewers"
        
        live_count = await redis.scard(session_key)
        unique_count = await redis.scard(unique_key)
        
        return {
            "live_viewers": live_count or 0,
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

    async def _periodic_cleanup(self):
        """
        Periodically clean up stale session data from Redis.
        Only cleans up events that have NO active WebSocket connections on this worker.
        Runs every 5 minutes.
        """
        CLEANUP_INTERVAL = 300  # 5 minutes
        SESSION_TTL = 600  # Sessions older than 10 minutes are considered stale
        
        while True:
            try:
                await asyncio.sleep(CLEANUP_INTERVAL)
                
                redis = await get_redis()
                
                # Get all live_sessions keys
                keys = await redis.keys("event:*:live_sessions")
                
                for key in keys:
                    # Extract event_id from key
                    try:
                        event_id = int(key.decode().split(":")[1])
                    except (ValueError, IndexError):
                        continue
                    
                    # Skip events with active connections on this worker
                    if event_id in self._rooms and len(self._rooms[event_id]) > 0:
                        continue
                    
                    # Get all sessions for this event
                    sessions = await redis.smembers(key)
                    current_time = time.time()
                    stale_sessions = []
                    
                    for session in sessions:
                        try:
                            # Session format: "{ws_id}:{timestamp}"
                            session_str = session.decode() if isinstance(session, bytes) else session
                            parts = session_str.rsplit(":", 1)
                            if len(parts) == 2:
                                session_time = float(parts[1])
                                # If session is older than TTL, mark as stale
                                if current_time - session_time > SESSION_TTL:
                                    stale_sessions.append(session)
                        except (ValueError, IndexError):
                            # Invalid session format, mark for removal
                            stale_sessions.append(session)
                    
                    # Remove stale sessions
                    if stale_sessions:
                        await redis.srem(key, *stale_sessions)
                        print(f"Cleaned up {len(stale_sessions)} stale sessions for event {event_id}")
                        
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"Cleanup error: {e}")
                # Continue running even if there's an error
                await asyncio.sleep(60)


manager = ConnectionManager()
