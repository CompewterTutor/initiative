"""End-to-end tests for the Privileged Access Management (PAM) endpoints."""

import pytest
from httpx import AsyncClient
from sqlmodel.ext.asyncio.session import AsyncSession

from app.models.user import UserRole
from app.testing import create_guild, create_user, get_auth_headers


@pytest.mark.integration
async def test_support_can_request_and_owner_approves(client: AsyncClient, session: AsyncSession):
    owner = await create_user(session, email="owner@example.com", role=UserRole.owner)
    support = await create_user(session, email="support@example.com", role=UserRole.support)
    # A guild the support user is NOT a member of.
    guild = await create_guild(session, creator=owner)

    # Support requests read access.
    resp = await client.post(
        "/api/v1/access-grants/",
        json={"guild_id": guild.id, "access_level": "read", "reason": "debugging a ticket"},
        headers=get_auth_headers(support),
    )
    assert resp.status_code == 201, resp.text
    grant = resp.json()
    assert grant["status"] == "pending"
    assert grant["is_live"] is False
    assert grant["guild_name"] == guild.name
    grant_id = grant["id"]

    # Owner sees it in the full queue (mine=false requires access.read).
    resp = await client.get(
        "/api/v1/access-grants/?mine=false&status=pending", headers=get_auth_headers(owner)
    )
    assert resp.status_code == 200
    assert any(g["id"] == grant_id for g in resp.json())

    # Owner approves.
    resp = await client.post(
        f"/api/v1/access-grants/{grant_id}/approve", json={}, headers=get_auth_headers(owner)
    )
    assert resp.status_code == 200, resp.text
    approved = resp.json()
    assert approved["status"] == "approved"
    assert approved["is_live"] is True
    assert approved["expires_at"] is not None


@pytest.mark.integration
async def test_member_cannot_request_access(client: AsyncClient, session: AsyncSession):
    """A plain member lacks access.request and is forbidden."""
    owner = await create_user(session, email="owner2@example.com", role=UserRole.owner)
    member = await create_user(session, email="member2@example.com", role=UserRole.member)
    guild = await create_guild(session, creator=owner)

    resp = await client.post(
        "/api/v1/access-grants/",
        json={"guild_id": guild.id, "reason": "no caps"},
        headers=get_auth_headers(member),
    )
    assert resp.status_code == 403


@pytest.mark.integration
async def test_requester_cannot_approve_own(client: AsyncClient, session: AsyncSession):
    """An admin can both request and approve, but never their own request."""
    owner = await create_user(session, email="owner3@example.com", role=UserRole.owner)
    admin = await create_user(session, email="admin3@example.com", role=UserRole.admin)
    guild = await create_guild(session, creator=owner)

    resp = await client.post(
        "/api/v1/access-grants/",
        json={"guild_id": guild.id, "reason": "self"},
        headers=get_auth_headers(admin),
    )
    assert resp.status_code == 201, resp.text
    grant_id = resp.json()["id"]

    resp = await client.post(
        f"/api/v1/access-grants/{grant_id}/approve", json={}, headers=get_auth_headers(admin)
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "ACCESS_GRANT_CANNOT_APPROVE_OWN"


@pytest.mark.integration
async def test_duration_over_cap_rejected(client: AsyncClient, session: AsyncSession):
    owner = await create_user(session, email="owner4@example.com", role=UserRole.owner)
    support = await create_user(session, email="support4@example.com", role=UserRole.support)
    guild = await create_guild(session, creator=owner)

    resp = await client.post(
        "/api/v1/access-grants/",
        json={
            "guild_id": guild.id,
            "reason": "too long",
            "requested_duration_minutes": 10_000,  # over the 24h cap
        },
        headers=get_auth_headers(support),
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "ACCESS_GRANT_DURATION_TOO_LONG"


@pytest.mark.integration
async def test_revoke_and_cancel(client: AsyncClient, session: AsyncSession):
    owner = await create_user(session, email="owner5@example.com", role=UserRole.owner)
    support = await create_user(session, email="support5@example.com", role=UserRole.support)
    guild = await create_guild(session, creator=owner)

    # Cancel own pending.
    resp = await client.post(
        "/api/v1/access-grants/",
        json={"guild_id": guild.id, "reason": "cancel me"},
        headers=get_auth_headers(support),
    )
    grant_id = resp.json()["id"]
    resp = await client.delete(
        f"/api/v1/access-grants/{grant_id}", headers=get_auth_headers(support)
    )
    assert resp.status_code == 204

    # Approve then revoke.
    resp = await client.post(
        "/api/v1/access-grants/",
        json={"guild_id": guild.id, "reason": "revoke me"},
        headers=get_auth_headers(support),
    )
    grant_id = resp.json()["id"]
    await client.post(
        f"/api/v1/access-grants/{grant_id}/approve", json={}, headers=get_auth_headers(owner)
    )
    resp = await client.post(
        f"/api/v1/access-grants/{grant_id}/revoke", headers=get_auth_headers(owner)
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "revoked"
    assert resp.json()["is_live"] is False
