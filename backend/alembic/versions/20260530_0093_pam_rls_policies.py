"""PAM read/write RLS policies for time-bound, per-guild access grants.

A live grant sets the ``app.pam_read`` / ``app.pam_write`` session variables
scoped to one guild (see ``set_rls_context``). This migration makes those flags
actually confer access:

1. ``is_initiative_member`` is taught to also return true when ``pam_read`` is
   set and the initiative belongs to the current guild. That one function backs
   every RESTRICTIVE initiative-membership policy, so a single change lets a
   grantee satisfy all of them for the granted guild (RESTRICTIVE policies AND
   together — additive permissive policies alone could never bypass them).

2. Additive PERMISSIVE policies are added per content table so the grantee also
   satisfies the PERMISSIVE guild-isolation layer: ``<t>_pam_read`` (SELECT) and,
   for content tables only, ``<t>_pam_write`` (INSERT/UPDATE/DELETE). These are
   purely additive — a session with neither flag set behaves exactly as before.

Scope (least privilege): grants reach guild *content*. Identity/config tables
(guild_memberships, guild_settings, guild_invites, oidc_claim_mappings) get no
PAM policy at all, and permission/role/membership tables are read-only under a
grant — a read_write grant can never escalate to guild admin.

Revision ID: 20260530_0093
Revises: 20260530_0092
Create Date: 2026-05-30
"""

from alembic import op
from sqlalchemy import text


revision = "20260530_0093"
down_revision = "20260530_0092"
branch_labels = None
depends_on = None


# PAM access is scoped by its OWN guild var, deliberately separate from
# current_guild_id (which the existing write policies treat as proof of
# membership). A grantee leaves current_guild_id unset and is scoped here.
PAM_GUILD = "NULLIF(current_setting('app.pam_guild_id', true), '')::int"
PAM_READ = "current_setting('app.pam_read', true) = 'true'"
PAM_WRITE = "current_setting('app.pam_write', true) = 'true'"

# Direct ``guild_id`` tables a grant may READ. Content plus access-control tables
# (the latter read-only, useful for debugging permission issues).
READ_TABLES = [
    "projects", "tasks", "subtasks", "task_statuses", "task_assignees",
    "documents", "document_file_versions", "document_links", "project_documents",
    "comments", "initiatives", "initiative_members", "tags",
    "queues", "queue_items", "queue_item_documents", "queue_item_tasks",
    "counters", "counter_groups",
    "calendar_events", "calendar_event_attendees", "calendar_event_documents",
    "uploads",
    "project_permissions", "project_role_permissions",
    "document_permissions", "document_role_permissions",
    "queue_permissions", "queue_role_permissions",
    "counter_group_permissions", "counter_group_role_permissions",
]

# Subset a read_write grant may also WRITE. Content only — no permission/role,
# membership, or structural (initiatives/initiative_members) tables.
WRITE_TABLES = [
    "projects", "tasks", "subtasks", "task_statuses", "task_assignees",
    "documents", "document_file_versions", "document_links", "project_documents",
    "comments", "tags",
    "queues", "queue_items", "queue_item_documents", "queue_item_tasks",
    "counters", "counter_groups",
    "calendar_events", "calendar_event_attendees", "calendar_event_documents",
    "uploads",
]

# Junction/value tables without a ``guild_id`` column, with the parent table +
# column that does carry the guild. (read + write)
#   (junction, fk_column, parent_table)
JUNCTION_TABLES = [
    ("task_tags", "tag_id", "tags"),
    ("document_tags", "tag_id", "tags"),
    ("project_tags", "tag_id", "tags"),
    ("queue_item_tags", "tag_id", "tags"),
    ("calendar_event_tags", "tag_id", "tags"),
    ("task_property_values", "task_id", "tasks"),
    ("document_property_values", "document_id", "documents"),
    ("calendar_event_property_values", "event_id", "calendar_events"),
]


def _exists(jt: str, fk: str, parent: str, flag: str) -> str:
    return (
        f"EXISTS (SELECT 1 FROM {parent} p WHERE p.id = {jt}.{fk} "
        f"AND p.guild_id = {PAM_GUILD}) AND {flag}"
    )


def upgrade() -> None:
    conn = op.get_bind()

    # 1. pam-aware is_initiative_member (backs every RESTRICTIVE initiative policy).
    conn.execute(text(f"""
        CREATE OR REPLACE FUNCTION public.is_initiative_member(p_initiative_id integer, p_user_id integer)
        RETURNS boolean
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
        AS $function$
            SELECT EXISTS (
                SELECT 1 FROM initiative_members
                WHERE initiative_id = p_initiative_id AND user_id = p_user_id
            )
            OR (
                {PAM_READ}
                AND EXISTS (
                    SELECT 1 FROM initiatives i
                    WHERE i.id = p_initiative_id AND i.guild_id = {PAM_GUILD}
                )
            )
        $function$
    """))

    # 2a. Additive permissive policies on direct guild_id tables.
    for t in READ_TABLES:
        conn.execute(text(
            f"CREATE POLICY {t}_pam_read ON {t} FOR SELECT "
            f"USING ({t}.guild_id = {PAM_GUILD} AND {PAM_READ})"
        ))
    for t in WRITE_TABLES:
        conn.execute(text(
            f"CREATE POLICY {t}_pam_insert ON {t} FOR INSERT "
            f"WITH CHECK ({t}.guild_id = {PAM_GUILD} AND {PAM_WRITE})"
        ))
        conn.execute(text(
            f"CREATE POLICY {t}_pam_update ON {t} FOR UPDATE "
            f"USING ({t}.guild_id = {PAM_GUILD} AND {PAM_WRITE}) "
            f"WITH CHECK ({t}.guild_id = {PAM_GUILD} AND {PAM_WRITE})"
        ))
        conn.execute(text(
            f"CREATE POLICY {t}_pam_delete ON {t} FOR DELETE "
            f"USING ({t}.guild_id = {PAM_GUILD} AND {PAM_WRITE})"
        ))

    # 2b. Junction/value tables: derive the guild through the parent table.
    for jt, fk, parent in JUNCTION_TABLES:
        conn.execute(text(
            f"CREATE POLICY {jt}_pam_read ON {jt} FOR SELECT "
            f"USING ({_exists(jt, fk, parent, PAM_READ)})"
        ))
        conn.execute(text(
            f"CREATE POLICY {jt}_pam_insert ON {jt} FOR INSERT "
            f"WITH CHECK ({_exists(jt, fk, parent, PAM_WRITE)})"
        ))
        conn.execute(text(
            f"CREATE POLICY {jt}_pam_update ON {jt} FOR UPDATE "
            f"USING ({_exists(jt, fk, parent, PAM_WRITE)}) "
            f"WITH CHECK ({_exists(jt, fk, parent, PAM_WRITE)})"
        ))
        conn.execute(text(
            f"CREATE POLICY {jt}_pam_delete ON {jt} FOR DELETE "
            f"USING ({_exists(jt, fk, parent, PAM_WRITE)})"
        ))


def downgrade() -> None:
    conn = op.get_bind()

    for jt, _fk, _parent in JUNCTION_TABLES:
        for suffix in ("read", "insert", "update", "delete"):
            conn.execute(text(f"DROP POLICY IF EXISTS {jt}_pam_{suffix} ON {jt}"))
    for t in WRITE_TABLES:
        for suffix in ("insert", "update", "delete"):
            conn.execute(text(f"DROP POLICY IF EXISTS {t}_pam_{suffix} ON {t}"))
    for t in READ_TABLES:
        conn.execute(text(f"DROP POLICY IF EXISTS {t}_pam_read ON {t}"))

    # Restore the original is_initiative_member (no pam awareness).
    conn.execute(text("""
        CREATE OR REPLACE FUNCTION public.is_initiative_member(p_initiative_id integer, p_user_id integer)
        RETURNS boolean
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
        AS $function$
            SELECT EXISTS (
                SELECT 1 FROM initiative_members
                WHERE initiative_id = p_initiative_id AND user_id = p_user_id
            )
        $function$
    """))
