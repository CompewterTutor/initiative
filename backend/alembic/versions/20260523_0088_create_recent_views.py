"""Polymorphic recent_views table.

Consolidates per-entity "recently viewed" tracking into a single
``recent_views(user_id, entity_type, entity_id, guild_id, last_viewed_at)``
table so the layout header can surface a mixed list of recently opened
projects, documents, queues, and counter groups.

Migrates rows from ``recent_project_views`` (entity_type='project') and
drops the legacy table.

Revision ID: 20260523_0088
Revises: 20260522_0087
Create Date: 2026-05-23
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

revision = "20260523_0088"
down_revision = "20260522_0087"
branch_labels = None
depends_on = None


ALLOWED_ENTITY_TYPES = ("project", "document", "queue", "counter_group")


def upgrade() -> None:
    op.create_table(
        "recent_views",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("entity_type", sa.Text(), nullable=False),
        sa.Column("entity_id", sa.Integer(), nullable=False),
        sa.Column("guild_id", sa.Integer(), nullable=True),
        sa.Column(
            "last_viewed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["guild_id"], ["guilds.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "entity_type", "entity_id"),
        sa.CheckConstraint(
            "entity_type IN ('project','document','queue','counter_group')",
            name="ck_recent_views_entity_type",
        ),
    )
    op.create_index(
        "ix_recent_views_user_last_viewed_at",
        "recent_views",
        ["user_id", sa.text("last_viewed_at DESC")],
    )
    op.create_index("ix_recent_views_guild_id", "recent_views", ["guild_id"])
    op.create_index(
        "ix_recent_views_entity",
        "recent_views",
        ["entity_type", "entity_id"],
    )

    connection = op.get_bind()

    # Trigger: populate guild_id from the underlying entity table.
    connection.execute(text("""
    CREATE OR REPLACE FUNCTION fn_recent_views_set_guild_id() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            IF NEW.guild_id IS NULL OR (TG_OP = 'UPDATE' AND (
                OLD.entity_type IS DISTINCT FROM NEW.entity_type
                OR OLD.entity_id IS DISTINCT FROM NEW.entity_id
            )) THEN
                CASE NEW.entity_type
                    WHEN 'project' THEN
                        SELECT guild_id INTO NEW.guild_id FROM projects
                        WHERE id = NEW.entity_id;
                    WHEN 'document' THEN
                        SELECT guild_id INTO NEW.guild_id FROM documents
                        WHERE id = NEW.entity_id;
                    WHEN 'queue' THEN
                        SELECT guild_id INTO NEW.guild_id FROM queues
                        WHERE id = NEW.entity_id;
                    WHEN 'counter_group' THEN
                        SELECT guild_id INTO NEW.guild_id FROM counter_groups
                        WHERE id = NEW.entity_id;
                END CASE;
            END IF;
            RETURN NEW;
        END;
        $$
    """))

    connection.execute(text("""
    CREATE TRIGGER tr_recent_views_set_guild_id
        BEFORE INSERT OR UPDATE OF entity_type, entity_id ON recent_views
        FOR EACH ROW EXECUTE FUNCTION fn_recent_views_set_guild_id()
    """))

    # Copy existing project view data BEFORE enabling FORCE RLS so the
    # plain INSERT doesn't hit policy checks. ``recent_project_views.guild_id``
    # is already populated by its own trigger.
    connection.execute(text("""
        INSERT INTO recent_views
            (user_id, entity_type, entity_id, guild_id, last_viewed_at)
        SELECT user_id, 'project', project_id, guild_id, last_viewed_at
        FROM recent_project_views
        ON CONFLICT (user_id, entity_type, entity_id) DO NOTHING
    """))

    # RLS: enable + force, then standard 4-policy CRUD pattern keyed off
    # the populated guild_id, plus a restrictive self-scope policy.
    GUILD_ID = "NULLIF(current_setting('app.current_guild_id'::text, true), ''::text)::integer"
    USER_ID = "NULLIF(current_setting('app.current_user_id'::text, true), ''::text)::integer"
    IS_SUPER = "current_setting('app.is_superadmin'::text, true) = 'true'::text"

    connection.execute(text("ALTER TABLE recent_views ENABLE ROW LEVEL SECURITY"))
    connection.execute(text("ALTER TABLE ONLY recent_views FORCE ROW LEVEL SECURITY"))

    # SELECT: scoped to the active guild. Unlike most guild-scoped tables
    # that allow cross-guild reads to any member, the recent-items bar is a
    # per-guild view, so SELECT mirrors INSERT/UPDATE/DELETE.
    connection.execute(text(f"""
        CREATE POLICY guild_select ON recent_views
            FOR SELECT
            USING ((guild_id = ({GUILD_ID})) OR ({IS_SUPER}))
    """))

    # INSERT: guild_id must match active guild (set by trigger from entity)
    connection.execute(text(f"""
        CREATE POLICY guild_insert ON recent_views
            FOR INSERT
            WITH CHECK ((guild_id = ({GUILD_ID})) OR ({IS_SUPER}))
    """))

    # UPDATE: same guild
    connection.execute(text(f"""
        CREATE POLICY guild_update ON recent_views
            FOR UPDATE
            USING ((guild_id = ({GUILD_ID})) OR ({IS_SUPER}))
            WITH CHECK ((guild_id = ({GUILD_ID})) OR ({IS_SUPER}))
    """))

    # DELETE: same guild
    connection.execute(text(f"""
        CREATE POLICY guild_delete ON recent_views
            FOR DELETE
            USING ((guild_id = ({GUILD_ID})) OR ({IS_SUPER}))
    """))

    # Restrictive self-scope: a user can only ever see/touch their own rows.
    connection.execute(text(f"""
        CREATE POLICY recent_views_self_scope ON recent_views
            AS RESTRICTIVE
            FOR ALL
            USING ((user_id = ({USER_ID})) OR ({IS_SUPER}))
            WITH CHECK ((user_id = ({USER_ID})) OR ({IS_SUPER}))
    """))

    # Drop the legacy table and its trigger/function. Policies + indexes go
    # with the table.
    connection.execute(text(
        "DROP TRIGGER IF EXISTS tr_recent_project_views_set_guild_id ON recent_project_views"
    ))
    op.drop_table("recent_project_views")
    connection.execute(text("DROP FUNCTION IF EXISTS fn_recent_project_views_set_guild_id()"))


def downgrade() -> None:
    connection = op.get_bind()

    # Recreate recent_project_views and its trigger/policies.
    op.create_table(
        "recent_project_views",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("guild_id", sa.Integer(), nullable=False),
        sa.Column(
            "last_viewed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["guild_id"], ["guilds.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "project_id"),
    )
    op.create_index(
        "ix_recent_project_views_guild_id", "recent_project_views", ["guild_id"]
    )
    op.create_index(
        "ix_recent_project_views_last_viewed_at",
        "recent_project_views",
        ["last_viewed_at"],
    )
    op.create_index(
        "ix_recent_project_views_project_id", "recent_project_views", ["project_id"]
    )
    op.create_index(
        "ix_recent_project_views_user_id", "recent_project_views", ["user_id"]
    )

    connection.execute(text("""
    CREATE OR REPLACE FUNCTION fn_recent_project_views_set_guild_id() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            IF NEW.guild_id IS NULL OR (TG_OP = 'UPDATE' AND OLD.project_id IS DISTINCT FROM NEW.project_id) THEN
                SELECT guild_id INTO NEW.guild_id FROM projects WHERE id = NEW.project_id;
            END IF;
            RETURN NEW;
        END;
        $$
    """))

    connection.execute(text("""
    CREATE TRIGGER tr_recent_project_views_set_guild_id
        BEFORE INSERT OR UPDATE OF project_id ON recent_project_views
        FOR EACH ROW EXECUTE FUNCTION fn_recent_project_views_set_guild_id()
    """))

    # Copy project rows back.
    connection.execute(text("""
        INSERT INTO recent_project_views
            (user_id, project_id, guild_id, last_viewed_at)
        SELECT user_id, entity_id, guild_id, last_viewed_at
        FROM recent_views
        WHERE entity_type = 'project'
        ON CONFLICT (user_id, project_id) DO NOTHING
    """))

    # Restore standard RLS policies on recent_project_views.
    GUILD_ID = "NULLIF(current_setting('app.current_guild_id'::text, true), ''::text)::integer"
    USER_ID = "NULLIF(current_setting('app.current_user_id'::text, true), ''::text)::integer"
    IS_SUPER = "current_setting('app.is_superadmin'::text, true) = 'true'::text"

    connection.execute(text("ALTER TABLE recent_project_views ENABLE ROW LEVEL SECURITY"))
    connection.execute(text("ALTER TABLE ONLY recent_project_views FORCE ROW LEVEL SECURITY"))
    connection.execute(text(f"""
        CREATE POLICY guild_select ON recent_project_views
            FOR SELECT USING (
                (EXISTS (
                    SELECT 1 FROM guild_memberships
                    WHERE guild_memberships.guild_id = recent_project_views.guild_id
                    AND guild_memberships.user_id = ({USER_ID})
                )) OR ({IS_SUPER})
            )
    """))
    connection.execute(text(f"""
        CREATE POLICY guild_insert ON recent_project_views
            FOR INSERT WITH CHECK ((guild_id = ({GUILD_ID})) OR ({IS_SUPER}))
    """))
    connection.execute(text(f"""
        CREATE POLICY guild_update ON recent_project_views
            FOR UPDATE
            USING ((guild_id = ({GUILD_ID})) OR ({IS_SUPER}))
            WITH CHECK ((guild_id = ({GUILD_ID})) OR ({IS_SUPER}))
    """))
    connection.execute(text(f"""
        CREATE POLICY guild_delete ON recent_project_views
            FOR DELETE USING ((guild_id = ({GUILD_ID})) OR ({IS_SUPER}))
    """))

    # Drop recent_views.
    connection.execute(text(
        "DROP TRIGGER IF EXISTS tr_recent_views_set_guild_id ON recent_views"
    ))
    op.drop_table("recent_views")
    connection.execute(text("DROP FUNCTION IF EXISTS fn_recent_views_set_guild_id()"))
