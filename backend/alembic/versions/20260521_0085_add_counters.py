"""Add counter group / counter tables with RLS.

Creates counter_groups, counters, counter_group_permissions, and
counter_group_role_permissions with guild isolation and initiative-scoped
RESTRICTIVE RLS policies. Also widens the permission_key CHECK constraint
to allow ``counters_enabled`` / ``create_counters`` and backfills both
permissions on every existing initiative role (managers ON, members OFF).

Revision ID: 20260521_0085
Revises: 20260515_0084
Create Date: 2026-05-21
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

revision = "20260521_0085"
down_revision = "20260515_0084"
branch_labels = None
depends_on = None


# ---------------------------------------------------------------------------
# RLS session-variable helpers (mirror queues migration)
# ---------------------------------------------------------------------------
GUILD_ID = "current_setting('app.current_guild_id'::text, true)::int"
USER_ID = "NULLIF(current_setting('app.current_user_id'::text, true), ''::text)::integer"
GUILD_ROLE = "current_setting('app.current_guild_role'::text, true)"
IS_SUPER = "current_setting('app.is_superadmin'::text, true) = 'true'::text"
IS_ADMIN = f"{GUILD_ROLE} = 'admin'::text"
BYPASS = f"OR ({IS_ADMIN}) OR ({IS_SUPER})"

GUILD_CHECK = f"guild_id = {GUILD_ID} OR {IS_SUPER}"

TABLES_DIRECT_INITIATIVE = ["counter_groups"]
TABLES_VIA_COUNTER_GROUP = [
    "counters",
    "counter_group_permissions",
    "counter_group_role_permissions",
]


def _init_member_direct(table: str) -> str:
    return (
        f"EXISTS ("
        f"SELECT 1 FROM initiatives "
        f"WHERE initiatives.id = {table}.initiative_id "
        f"AND is_initiative_member(initiatives.id, ({USER_ID}))"
        f")"
    )


def _init_member_via_counter_group(table: str) -> str:
    return (
        f"EXISTS ("
        f"SELECT 1 FROM counter_groups "
        f"WHERE counter_groups.id = {table}.counter_group_id "
        f"AND is_initiative_member(counter_groups.initiative_id, ({USER_ID}))"
        f")"
    )


def _add_rls_policies(conn, table: str, membership_expr: str) -> None:
    conn.execute(text(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY"))
    conn.execute(text(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY"))

    conn.execute(text(
        f"CREATE POLICY guild_isolation ON {table} "
        f"AS PERMISSIVE FOR ALL "
        f"USING ({GUILD_CHECK}) "
        f"WITH CHECK ({GUILD_CHECK})"
    ))

    bypass_expr = f"({membership_expr} {BYPASS})"
    conn.execute(text(
        f"CREATE POLICY initiative_member_select ON {table} "
        f"AS RESTRICTIVE FOR SELECT USING ({bypass_expr})"
    ))
    conn.execute(text(
        f"CREATE POLICY initiative_member_insert ON {table} "
        f"AS RESTRICTIVE FOR INSERT WITH CHECK ({bypass_expr})"
    ))
    conn.execute(text(
        f"CREATE POLICY initiative_member_update ON {table} "
        f"AS RESTRICTIVE FOR UPDATE USING ({bypass_expr}) WITH CHECK ({bypass_expr})"
    ))
    conn.execute(text(
        f"CREATE POLICY initiative_member_delete ON {table} "
        f"AS RESTRICTIVE FOR DELETE USING ({bypass_expr})"
    ))


def _drop_rls(conn, table: str) -> None:
    for policy in [
        "guild_isolation",
        "initiative_member_select",
        "initiative_member_insert",
        "initiative_member_update",
        "initiative_member_delete",
    ]:
        conn.execute(text(f"DROP POLICY IF EXISTS {policy} ON {table}"))
    conn.execute(text(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY"))


def upgrade() -> None:
    # -- counter_groups --
    op.create_table(
        "counter_groups",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("guild_id", sa.Integer(), nullable=False),
        sa.Column("initiative_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_by_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.Integer(), nullable=True),
        sa.Column("purge_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["guild_id"], ["guilds.id"]),
        sa.ForeignKeyConstraint(["initiative_id"], ["initiatives.id"]),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["deleted_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_counter_groups_guild_id", "counter_groups", ["guild_id"])
    op.create_index("ix_counter_groups_initiative_id", "counter_groups", ["initiative_id"])

    # -- counters --
    op.create_table(
        "counters",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("guild_id", sa.Integer(), nullable=False),
        sa.Column("counter_group_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("color", sa.String(length=32), nullable=True),
        sa.Column("count", sa.Numeric(20, 10), nullable=False, server_default="0"),
        sa.Column("min", sa.Numeric(20, 10), nullable=True),
        sa.Column("max", sa.Numeric(20, 10), nullable=True),
        sa.Column("step", sa.Numeric(20, 10), nullable=False, server_default="1"),
        sa.Column("initial_count", sa.Numeric(20, 10), nullable=False, server_default="0"),
        sa.Column(
            "view_mode",
            sa.Enum("number", "progress_bar", "segmented_clock", name="counter_view_mode"),
            nullable=False,
            server_default="number",
        ),
        sa.Column("position", sa.Numeric(20, 10), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.Integer(), nullable=True),
        sa.Column("purge_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["guild_id"], ["guilds.id"]),
        sa.ForeignKeyConstraint(["counter_group_id"], ["counter_groups.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["deleted_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_counters_guild_id", "counters", ["guild_id"])
    op.create_index("ix_counters_counter_group_id", "counters", ["counter_group_id"])
    op.create_index("ix_counters_group_position", "counters", ["counter_group_id", "position"])

    # -- counter_group_permissions (creates the counter_permission_level enum) --
    op.create_table(
        "counter_group_permissions",
        sa.Column("counter_group_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("guild_id", sa.Integer(), nullable=False),
        sa.Column(
            "level",
            sa.Enum("owner", "write", "read", name="counter_permission_level"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["counter_group_id"], ["counter_groups.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["guild_id"], ["guilds.id"]),
        sa.PrimaryKeyConstraint("counter_group_id", "user_id"),
    )
    op.create_index("ix_counter_group_permissions_user_id", "counter_group_permissions", ["user_id"])

    # -- counter_group_role_permissions --
    op.create_table(
        "counter_group_role_permissions",
        sa.Column("counter_group_id", sa.Integer(), nullable=False),
        sa.Column("initiative_role_id", sa.Integer(), nullable=False),
        sa.Column("guild_id", sa.Integer(), nullable=False),
        sa.Column(
            "level",
            sa.Enum("owner", "write", "read", name="counter_permission_level", create_type=False),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["counter_group_id"], ["counter_groups.id"]),
        sa.ForeignKeyConstraint(["initiative_role_id"], ["initiative_roles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["guild_id"], ["guilds.id"]),
        sa.PrimaryKeyConstraint("counter_group_id", "initiative_role_id"),
    )

    # -- initiatives.counters_enabled column --
    op.add_column(
        "initiatives",
        sa.Column("counters_enabled", sa.Boolean(), nullable=False, server_default="false"),
    )

    # -- RLS policies --
    conn = op.get_bind()
    for table in TABLES_DIRECT_INITIATIVE:
        _add_rls_policies(conn, table, _init_member_direct(table))
    for table in TABLES_VIA_COUNTER_GROUP:
        _add_rls_policies(conn, table, _init_member_via_counter_group(table))

    # -- Widen the permission_key CHECK constraint --
    conn.execute(text(
        "ALTER TABLE initiative_role_permissions "
        "DROP CONSTRAINT IF EXISTS ck_initiative_role_permissions_permission_key"
    ))
    conn.execute(text(
        "ALTER TABLE initiative_role_permissions "
        "ADD CONSTRAINT ck_initiative_role_permissions_permission_key "
        "CHECK (permission_key IN ("
        "'docs_enabled', 'projects_enabled', 'create_docs', 'create_projects', "
        "'queues_enabled', 'create_queues', "
        "'events_enabled', 'create_events', "
        "'advanced_tool_enabled', 'create_advanced_tool', "
        "'counters_enabled', 'create_counters'))"
    ))

    # -- Backfill initiative role permissions for new counter keys --
    for key in ("counters_enabled", "create_counters"):
        conn.execute(text(f"""
            INSERT INTO initiative_role_permissions (initiative_role_id, permission_key, enabled)
            SELECT ir.id, '{key}', ir.is_manager
            FROM initiative_roles ir
            WHERE NOT EXISTS (
                SELECT 1 FROM initiative_role_permissions irp
                WHERE irp.initiative_role_id = ir.id
                  AND irp.permission_key = '{key}'
            )
        """))

    # -- Grant app_admin privileges on new tables --
    counter_tables = [
        "counter_groups",
        "counters",
        "counter_group_permissions",
        "counter_group_role_permissions",
    ]
    for table in counter_tables:
        conn.execute(text(f"GRANT ALL PRIVILEGES ON TABLE {table} TO app_admin"))
    conn.execute(text("GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO app_admin"))


def downgrade() -> None:
    conn = op.get_bind()

    # Remove backfilled permissions before tightening the CHECK constraint.
    conn.execute(text(
        "DELETE FROM initiative_role_permissions "
        "WHERE permission_key IN ('counters_enabled', 'create_counters')"
    ))

    # Restore previous CHECK constraint (post-0080 set).
    conn.execute(text(
        "ALTER TABLE initiative_role_permissions "
        "DROP CONSTRAINT IF EXISTS ck_initiative_role_permissions_permission_key"
    ))
    conn.execute(text(
        "ALTER TABLE initiative_role_permissions "
        "ADD CONSTRAINT ck_initiative_role_permissions_permission_key "
        "CHECK (permission_key IN ("
        "'docs_enabled', 'projects_enabled', 'create_docs', 'create_projects', "
        "'queues_enabled', 'create_queues', "
        "'events_enabled', 'create_events', "
        "'advanced_tool_enabled', 'create_advanced_tool'))"
    ))

    # Drop RLS policies
    for table in TABLES_VIA_COUNTER_GROUP + TABLES_DIRECT_INITIATIVE:
        _drop_rls(conn, table)

    # Drop the master-switch column on initiatives
    op.drop_column("initiatives", "counters_enabled")

    # Drop tables in reverse FK dependency order
    op.drop_table("counter_group_role_permissions")
    op.drop_table("counter_group_permissions")
    op.drop_table("counters")
    op.drop_table("counter_groups")

    # Drop enum types
    conn.execute(text("DROP TYPE IF EXISTS counter_permission_level"))
    conn.execute(text("DROP TYPE IF EXISTS counter_view_mode"))
