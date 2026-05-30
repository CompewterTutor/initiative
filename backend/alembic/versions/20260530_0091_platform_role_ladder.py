"""Extend the platform user_role enum into a 5-role ladder.

Adds ``support``, ``moderator`` and ``owner`` to the ``user_role`` Postgres
enum (previously just ``admin``/``member``) and promotes every existing
``admin`` to ``owner`` so no one loses power: ``owner`` is the only role that
retains app-wide configuration access under the new capability model
(``app.core.capabilities``). The ``admin`` tier still exists for future
grants — it just no longer carries config-management on its own.

Revision ID: 20260530_0091
Revises: 20260528_0090
Create Date: 2026-05-30
"""

from alembic import op
from sqlalchemy import text

revision = "20260530_0091"
down_revision = "20260528_0090"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ALTER TYPE ... ADD VALUE cannot run inside a transaction block on
    # Postgres < 12; autocommit_block() is the supported workaround and is
    # harmless on Postgres 17. Committing here also makes the new values
    # usable by the UPDATE below (Postgres forbids using a freshly-added
    # enum value in the same transaction that added it).
    with op.get_context().autocommit_block():
        for value in ("support", "moderator", "owner"):
            op.execute(text(f"ALTER TYPE user_role ADD VALUE IF NOT EXISTS '{value}'"))

    # Behaviour-preserving promotion: existing platform admins held full power
    # (including app config), which is now the ``owner`` tier.
    op.execute(text("UPDATE users SET role = 'owner' WHERE role = 'admin'"))


def downgrade() -> None:
    # Postgres can't drop enum values, so we can't fully reverse the type
    # change. We do collapse the new roles back onto the original two so a
    # downgraded deployment never holds a role its (older) code can't parse.
    op.execute(text("UPDATE users SET role = 'admin' WHERE role = 'owner'"))
    op.execute(text("UPDATE users SET role = 'member' WHERE role IN ('support', 'moderator')"))
