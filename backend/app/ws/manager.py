import asyncio
import json
from collections import defaultdict
from typing import Any

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self):
        # event_id -> list of WebSocket connections
        self._rooms: dict[int, list[WebSocket]] = defaultdict(list)

    async def connect(self, event_id: int, ws: WebSocket):
        await ws.accept()
        self._rooms[event_id].append(ws)

    def disconnect(self, event_id: int, ws: WebSocket):
        self._rooms[event_id].remove(ws)
        if not self._rooms[event_id]:
            del self._rooms[event_id]

    async def broadcast(self, event_id: int, message: dict[str, Any]):
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
