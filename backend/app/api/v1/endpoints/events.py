import json
import logging
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from sqlalchemy import text

from sqlmodel.ext.asyncio.session import AsyncSession

from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.models.user import User
from app.services.realtime import manager
from app.services.ws_auth import authenticate_ws_token

router = APIRouter()
logger = logging.getLogger(__name__)

# Message type for authentication (matches frontend)
MSG_AUTH = 5


async def _user_from_token(token: str, session: AsyncSession) -> Optional[User]:
    """Validate a session JWT or device token and return the user, or None.

    Delegates to the shared ``authenticate_ws_token`` helper so the
    ``token_version`` revocation check stays in lockstep with the HTTP auth
    path and the other realtime WebSocket endpoints (SEC-4).
    """
    return await authenticate_ws_token(token, session)


@router.websocket("/updates")
async def websocket_updates(websocket: WebSocket):
    """
    WebSocket endpoint for real-time updates.

    Authentication is done via MSG_AUTH message sent immediately after connection,
    not via URL query parameters (for security - prevents token leakage in logs).
    """
    await websocket.accept()

    # Wait for authentication message (must be first message)
    try:
        auth_data = await websocket.receive_bytes()
        if len(auth_data) < 2 or auth_data[0] != MSG_AUTH:
            logger.warning("Events WebSocket: Expected MSG_AUTH as first message")
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        # Parse auth payload
        try:
            auth_payload = json.loads(auth_data[1:].decode())
            token = auth_payload.get("token")
            if not token:
                # Fall back to session cookie (web sessions after page refresh)
                token = websocket.cookies.get(settings.COOKIE_NAME)
            if not token:
                raise ValueError("Missing token")
        except (json.JSONDecodeError, ValueError) as e:
            logger.warning(f"Events WebSocket: Invalid auth payload: {e}")
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

    except WebSocketDisconnect:
        logger.info("Events WebSocket: Client disconnected before auth")
        return

    # Validate the token in a SHORT-LIVED session and release it before the
    # keepalive loop. Holding a request-scoped session for the websocket's whole
    # lifetime keeps a connection idle-in-transaction, whose locks block DDL like
    # DROP SCHEMA (guild deletion). Mirrors the queue/counter websockets.
    async with AsyncSessionLocal() as session:
        # Reset any stale GUCs the pooled connection may carry (e.g. a SET ROLE to
        # a since-dropped guild role would make every query error) before the auth
        # query — AsyncSessionLocal doesn't run get_session's per-request reset.
        await session.execute(
            text(
                "SELECT set_config('role', 'none', false), set_config('search_path', 'public', false)"
            )
        )
        user = await _user_from_token(token, session)
    if not user:
        logger.warning("Events WebSocket: Auth failed")
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await manager.add_connection(websocket)
    try:
        while True:
            # Keep the connection alive by awaiting incoming messages
            await websocket.receive_text()
    except WebSocketDisconnect:
        await manager.disconnect(websocket)
    except Exception:
        await manager.disconnect(websocket)
        await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
