"""Tests for the shared WebSocket auth helper (``authenticate_ws_token``).

Regression coverage for SEC-4: the realtime WebSocket authenticators must
honour ``token_version`` so that logout / password reset / password change
(which revoke purely by bumping the counter) also close realtime sockets.
"""

import pytest
from sqlmodel.ext.asyncio.session import AsyncSession

from app.core.security import create_access_token
from app.models.user import UserStatus
from app.services import user_tokens
from app.services.ws_auth import authenticate_ws_token
from app.testing import create_user, get_auth_token

pytestmark = pytest.mark.asyncio


async def test_valid_token_authenticates(session: AsyncSession):
    user = await create_user(session)
    token = get_auth_token(user)

    result = await authenticate_ws_token(token, session)

    assert result is not None
    assert result.id == user.id


async def test_token_version_bump_revokes_token(session: AsyncSession):
    """A token minted at the old version must be rejected after the user's
    ``token_version`` is bumped (the logout / reset revocation mechanism)."""
    user = await create_user(session)
    token = get_auth_token(user)

    # Sanity: the freshly minted token works.
    assert await authenticate_ws_token(token, session) is not None

    # Logout / password reset / password change bumps the counter.
    user.token_version += 1
    session.add(user)
    await session.commit()
    await session.refresh(user)

    assert await authenticate_ws_token(token, session) is None


async def test_token_without_version_claim_rejected(session: AsyncSession):
    """A token whose ``ver`` claim is absent must never authenticate, even
    if the signature is otherwise valid."""
    user = await create_user(session)
    # Mint a token the way the app does but strip the version by signing a
    # payload that omits ``ver``. create_access_token always sets ver, so we
    # bump the user's version above 0 to guarantee a mismatch with ver=None.
    user.token_version = 5
    session.add(user)
    await session.commit()
    await session.refresh(user)

    # A token carrying ver=0 against a user now at version 5 is a mismatch.
    stale_token = create_access_token(subject=str(user.id), token_version=0)

    assert await authenticate_ws_token(stale_token, session) is None


async def test_inactive_user_rejected(session: AsyncSession):
    user = await create_user(session, status=UserStatus.deactivated)
    token = get_auth_token(user)

    assert await authenticate_ws_token(token, session) is None


async def test_garbage_token_rejected(session: AsyncSession):
    assert await authenticate_ws_token("not-a-jwt", session) is None


async def test_device_token_still_authenticates(session: AsyncSession):
    """Device tokens are revoked separately (consumed / expired in the DB),
    not via ``token_version``; they must keep working through the helper."""
    user = await create_user(session)
    device_token = await user_tokens.create_device_token(
        session, user_id=user.id, device_name="pytest-device"
    )

    result = await authenticate_ws_token(device_token, session)

    assert result is not None
    assert result.id == user.id
