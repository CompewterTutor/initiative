"""Integration tests for the server-held guild context.

The guild context is one nullable flag (``users.active_guild_id``, NULL =
personal mode) set by ``PUT /users/me/guild-context`` and resolved by the
request dependencies on every call — requests carry no guild context of their
own. These tests cover the endpoint's fail-closed validation, the 409 that
single-guild endpoints return in personal mode, the per-request defense in
depth against a stale/forged flag, and the ``X-Resolved-Guild`` echo header
the client's context guard relies on.
"""

import pytest
from httpx import AsyncClient
from sqlmodel.ext.asyncio.session import AsyncSession

from app.models.guild import GuildRole
from app.testing.factories import (
    create_guild,
    create_guild_membership,
    create_user,
    get_auth_headers,
    get_guild_headers,
)


@pytest.mark.integration
async def test_set_guild_context_for_member(client: AsyncClient, session: AsyncSession):
    """A member can enter their guild; the flag round-trips on UserRead."""
    user = await create_user(session)
    guild = await create_guild(session, creator=user)
    await create_guild_membership(session, user=user, guild=guild)

    response = await client.put(
        "/api/v1/users/me/guild-context",
        headers=get_auth_headers(user),
        json={"guild_id": guild.id},
    )
    assert response.status_code == 200
    assert response.json()["active_guild_id"] == guild.id

    me = await client.get("/api/v1/users/me", headers=get_auth_headers(user))
    assert me.json()["active_guild_id"] == guild.id


@pytest.mark.integration
async def test_set_guild_context_null_enters_personal_mode(
    client: AsyncClient, session: AsyncSession
):
    user = await create_user(session)
    guild = await create_guild(session, creator=user)
    await create_guild_membership(session, user=user, guild=guild)
    headers = await get_guild_headers(session, guild, user)

    response = await client.put(
        "/api/v1/users/me/guild-context",
        headers=headers,
        json={"guild_id": None},
    )
    assert response.status_code == 200
    assert response.json()["active_guild_id"] is None


@pytest.mark.integration
async def test_set_guild_context_rejects_non_member_without_confirming_existence(
    client: AsyncClient, session: AsyncSession
):
    """Fail closed: not a member, no live grant → 403, whether or not the
    guild exists."""
    user = await create_user(session)
    other = await create_user(session)
    foreign_guild = await create_guild(session, creator=other)
    await create_guild_membership(session, user=other, guild=foreign_guild)

    for guild_id in (foreign_guild.id, foreign_guild.id + 999):
        response = await client.put(
            "/api/v1/users/me/guild-context",
            headers=get_auth_headers(user),
            json={"guild_id": guild_id},
        )
        assert response.status_code == 403
        assert response.json()["detail"] == "GUILD_ACCESS_DENIED"


@pytest.mark.integration
async def test_personal_mode_409s_on_single_guild_endpoints(
    client: AsyncClient, session: AsyncSession
):
    """With no guild context, guild-scoped endpoints return a clean 409."""
    user = await create_user(session)
    guild = await create_guild(session, creator=user)
    await create_guild_membership(session, user=user, guild=guild)
    assert user.active_guild_id is None  # personal mode by default

    response = await client.get("/api/v1/initiatives/", headers=get_auth_headers(user))
    assert response.status_code == 409
    assert response.json()["detail"] == "NO_GUILD_MEMBERSHIP"


@pytest.mark.integration
async def test_stale_flag_fails_closed_per_request(
    client: AsyncClient, session: AsyncSession
):
    """Defense in depth: a flag pointing at a guild the user can't access
    (written directly, bypassing the endpoint's validation) yields 403 on
    every guild-scoped request — never another guild's data."""
    owner = await create_user(session)
    guild = await create_guild(session, creator=owner)
    await create_guild_membership(session, user=owner, guild=guild)

    outsider = await create_user(session)
    headers = await get_guild_headers(session, guild, outsider)  # unvalidated write

    response = await client.get("/api/v1/initiatives/", headers=headers)
    assert response.status_code == 403
    assert response.json()["detail"] == "GUILD_ACCESS_DENIED"


@pytest.mark.integration
async def test_resolved_guild_echo_header(client: AsyncClient, session: AsyncSession):
    """Guild-scoped responses echo the resolved guild; user-scoped ones don't."""
    user = await create_user(session)
    guild = await create_guild(session, creator=user)
    await create_guild_membership(session, user=user, guild=guild, role=GuildRole.admin)
    headers = await get_guild_headers(session, guild, user)

    scoped = await client.get("/api/v1/initiatives/", headers=headers)
    assert scoped.status_code == 200
    assert scoped.headers.get("X-Resolved-Guild") == str(guild.id)

    unscoped = await client.get("/api/v1/users/me", headers=headers)
    assert unscoped.status_code == 200
    assert "X-Resolved-Guild" not in unscoped.headers


@pytest.mark.integration
async def test_addressed_request_is_not_echo_stamped(
    client: AsyncClient, session: AsyncSession
):
    """Explicit ?guild_id= addressing is intentional cross-guild work — the
    response must not carry the ambient echo (the client guard would discard
    it)."""
    user = await create_user(session)
    guild_a = await create_guild(session, creator=user)
    await create_guild_membership(
        session, user=user, guild=guild_a, role=GuildRole.admin
    )
    guild_b = await create_guild(session, creator=user)
    await create_guild_membership(
        session, user=user, guild=guild_b, role=GuildRole.admin
    )
    headers = await get_guild_headers(session, guild_a, user)

    response = await client.get(
        f"/api/v1/initiatives/?guild_id={guild_b.id}", headers=headers
    )
    assert response.status_code == 200
    assert "X-Resolved-Guild" not in response.headers


@pytest.mark.integration
async def test_addressed_request_validates_access(
    client: AsyncClient, session: AsyncSession
):
    """?guild_id= addressing goes through the same fail-closed validation as
    the context PUT."""
    user = await create_user(session)
    guild = await create_guild(session, creator=user)
    await create_guild_membership(session, user=user, guild=guild)

    other = await create_user(session)
    foreign = await create_guild(session, creator=other)
    await create_guild_membership(session, user=other, guild=foreign)
    headers = await get_guild_headers(session, guild, user)

    response = await client.get(
        f"/api/v1/initiatives/?guild_id={foreign.id}", headers=headers
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "GUILD_ACCESS_DENIED"
