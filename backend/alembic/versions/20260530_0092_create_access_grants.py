"""Create access_grants table (Privileged Access Management).

Time-bound, per-guild access grants: a lower-privilege platform user requests
temporary access to one guild, an approver grants it, and it auto-expires.
See ``app.models.access_grant``.

The table is platform-scoped (managed cross-guild by ``owner``/``admin`` via
the RLS-bypassing admin session), so the RLS policy here is belt-and-
suspenders: a grantee can read their own rows, superadmins see all.

Revision ID: 20260530_0092
Revises: 20260530_0091
Create Date: 2026-05-30
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


revision = "20260530_0092"
down_revision = "20260530_0091"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "access_grants",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("guild_id", sa.Integer(), nullable=False),
        sa.Column(
            "access_level", sa.String(length=16), nullable=False, server_default="read"
        ),
        sa.Column(
            "status", sa.String(length=16), nullable=False, server_default="pending"
        ),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("requested_duration_minutes", sa.Integer(), nullable=False),
        sa.Column("requested_by_id", sa.Integer(), nullable=False),
        sa.Column("approved_by_id", sa.Integer(), nullable=True),
        sa.Column("revoked_by_id", sa.Integer(), nullable=True),
        sa.Column(
            "requested_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["guild_id"], ["guilds.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["requested_by_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["approved_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["revoked_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.CheckConstraint(
            "access_level IN ('read', 'read_write')",
            name="ck_access_grants_access_level",
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'approved', 'denied', 'revoked', 'expired')",
            name="ck_access_grants_status",
        ),
    )
    op.create_index("ix_access_grants_user_id", "access_grants", ["user_id"])
    op.create_index("ix_access_grants_guild_id", "access_grants", ["guild_id"])
    op.create_index("ix_access_grants_status", "access_grants", ["status"])
    # Supports the live-grant lookup (user + guild + status + expiry).
    op.create_index(
        "ix_access_grants_user_guild", "access_grants", ["user_id", "guild_id"]
    )

    connection = op.get_bind()

    USER_ID = "NULLIF(current_setting('app.current_user_id'::text, true), ''::text)::integer"
    IS_SUPER = "current_setting('app.is_superadmin'::text, true) = 'true'::text"

    connection.execute(text("ALTER TABLE access_grants ENABLE ROW LEVEL SECURITY"))
    connection.execute(text("ALTER TABLE ONLY access_grants FORCE ROW LEVEL SECURITY"))

    # Belt-and-suspenders: the grantee sees their own rows; superadmins (and
    # the admin session that endpoints actually use) see everything.
    connection.execute(text(f"""
        CREATE POLICY access_grants_self_or_super ON access_grants
            FOR ALL
            USING ((user_id = ({USER_ID})) OR ({IS_SUPER}))
            WITH CHECK ((user_id = ({USER_ID})) OR ({IS_SUPER}))
    """))


def downgrade() -> None:
    connection = op.get_bind()
    connection.execute(
        text("DROP POLICY IF EXISTS access_grants_self_or_super ON access_grants")
    )
    connection.execute(text("ALTER TABLE access_grants DISABLE ROW LEVEL SECURITY"))
    op.drop_index("ix_access_grants_user_guild", table_name="access_grants")
    op.drop_index("ix_access_grants_status", table_name="access_grants")
    op.drop_index("ix_access_grants_guild_id", table_name="access_grants")
    op.drop_index("ix_access_grants_user_id", table_name="access_grants")
    op.drop_table("access_grants")
