"""DB-level RLS isolation tests for PAM grants.

The test database connects as a BYPASSRLS superuser, so these tests explicitly
``SET ROLE app_user`` (the non-privileged role the app uses at runtime) to make
RLS + FORCE ROW LEVEL SECURITY actually apply. Without that, the policies would
silently pass and prove nothing.
"""

import pytest
from sqlalchemy import text
from sqlmodel.ext.asyncio.session import AsyncSession

from app.db.session import set_rls_context
from app.models.user import UserRole
from app.testing import create_guild, create_initiative, create_project, create_user


async def _set_app_user(session: AsyncSession) -> None:
    await session.execute(text("SET ROLE app_user"))


async def _reset_role(session: AsyncSession) -> None:
    await session.execute(text("RESET ROLE"))


@pytest.mark.integration
async def test_pam_read_grant_sees_only_granted_guild(session: AsyncSession):
    owner = await create_user(session, email="owner@example.com", role=UserRole.owner)
    support = await create_user(session, email="support@example.com", role=UserRole.support)

    guild_a = await create_guild(session, creator=owner)
    init_a = await create_initiative(session, guild_a, owner)
    proj_a = await create_project(session, init_a, owner, name="Alpha")

    guild_b = await create_guild(session, creator=owner)
    init_b = await create_initiative(session, guild_b, owner)
    proj_b = await create_project(session, init_b, owner, name="Bravo")

    try:
        await _set_app_user(session)

        # Live READ grant scoped to guild A.
        await set_rls_context(
            session, user_id=support.id, pam_guild_id=guild_a.id, pam_read=True, pam_write=False
        )

        visible_a = (
            await session.execute(text("SELECT id FROM projects WHERE id = :p"), {"p": proj_a.id})
        ).all()
        assert len(visible_a) == 1, "read grant should see the granted guild's project"

        # Cross-guild isolation: project in guild B is invisible.
        visible_b = (
            await session.execute(text("SELECT id FROM projects WHERE id = :p"), {"p": proj_b.id})
        ).all()
        assert len(visible_b) == 0, "read grant must NOT see other guilds"

        # Read grant is read-only: UPDATE matches no writable row.
        result = await session.execute(
            text("UPDATE projects SET name = 'hacked' WHERE id = :p"), {"p": proj_a.id}
        )
        assert result.rowcount == 0, "read grant must not be able to write"
    finally:
        await _reset_role(session)


@pytest.mark.integration
async def test_no_pam_flag_sees_nothing(session: AsyncSession):
    owner = await create_user(session, email="owner2@example.com", role=UserRole.owner)
    support = await create_user(session, email="support2@example.com", role=UserRole.support)
    guild = await create_guild(session, creator=owner)
    init = await create_initiative(session, guild, owner)
    proj = await create_project(session, init, owner, name="Gamma")

    try:
        await _set_app_user(session)
        # Same guild context but NO pam flag — a non-member must see nothing.
        await set_rls_context(
            session, user_id=support.id, pam_guild_id=guild.id, pam_read=False, pam_write=False
        )
        rows = (
            await session.execute(text("SELECT id FROM projects WHERE id = :p"), {"p": proj.id})
        ).all()
        assert len(rows) == 0
    finally:
        await _reset_role(session)


@pytest.mark.integration
async def test_pam_write_grant_can_update(session: AsyncSession):
    owner = await create_user(session, email="owner3@example.com", role=UserRole.owner)
    support = await create_user(session, email="support3@example.com", role=UserRole.support)
    guild = await create_guild(session, creator=owner)
    init = await create_initiative(session, guild, owner)
    proj = await create_project(session, init, owner, name="Delta")

    try:
        await _set_app_user(session)
        # READ_WRITE grant sets both flags.
        await set_rls_context(
            session, user_id=support.id, pam_guild_id=guild.id, pam_read=True, pam_write=True
        )
        result = await session.execute(
            text("UPDATE projects SET name = 'edited' WHERE id = :p"), {"p": proj.id}
        )
        assert result.rowcount == 1, "read_write grant should be able to update content"
    finally:
        await _reset_role(session)
