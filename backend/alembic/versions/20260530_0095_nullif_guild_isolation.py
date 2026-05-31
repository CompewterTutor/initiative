"""Guard legacy guild_isolation policies against an empty current_guild_id.

Thirteen guild-scoped tables still carry the original ``guild_isolation``
policy whose predicate casts ``current_setting('app.current_guild_id')`` to
``integer`` *without* a ``NULLIF`` guard. Postgres evaluates every PERMISSIVE
policy's expression, so when ``app.current_guild_id`` is unset (an empty
string) the bare ``''::integer`` cast raises
``invalid input syntax for type integer: ""`` and the whole query 500s —
even if another PERMISSIVE policy (e.g. the additive ``*_pam_read``) would
have matched.

A PAM grantee deliberately leaves ``current_guild_id`` unset and is scoped via
``pam_guild_id`` instead, so every query against these tables faulted for
grantees (queues, counters, calendar, uploads, …). Newer tables (projects,
documents) already use the ``NULLIF(..., '')::int`` form; this migration brings
the stragglers in line.

Behaviour-preserving for real members: a valid integer is unchanged by
``NULLIF(x, '')``; only the empty-string case flips from "error" to "no match"
(NULL), letting the superadmin / PAM policies decide.

Revision ID: 20260530_0095
Revises: 20260530_0094
Create Date: 2026-05-30
"""

from alembic import op
from sqlalchemy import text

revision = "20260530_0095"
down_revision = "20260530_0094"
branch_labels = None
depends_on = None

# Tables whose guild_isolation policy still casts current_guild_id without NULLIF.
TABLES = [
    "calendar_event_attendees",
    "calendar_events",
    "counter_group_permissions",
    "counter_group_role_permissions",
    "counter_groups",
    "counters",
    "document_file_versions",
    "queue_items",
    "queue_permissions",
    "queue_role_permissions",
    "queues",
    "uploads",
    "webhook_subscriptions",
]

IS_SUPER = "current_setting('app.is_superadmin', true) = 'true'"

# Old (unguarded) and new (NULLIF-guarded) predicates. All 13 policies are
# PERMISSIVE FOR ALL with identical USING and WITH CHECK expressions.
_GUARDED = (
    "guild_id = NULLIF(current_setting('app.current_guild_id', true), '')::integer "
    f"OR {IS_SUPER}"
)
_UNGUARDED = (
    "guild_id = current_setting('app.current_guild_id', true)::integer "
    f"OR {IS_SUPER}"
)


def _recreate(predicate: str) -> None:
    conn = op.get_bind()
    for t in TABLES:
        conn.execute(text(f"DROP POLICY IF EXISTS guild_isolation ON {t}"))
        conn.execute(
            text(
                f"CREATE POLICY guild_isolation ON {t} FOR ALL "
                f"USING ({predicate}) WITH CHECK ({predicate})"
            )
        )


def upgrade() -> None:
    _recreate(_GUARDED)


def downgrade() -> None:
    _recreate(_UNGUARDED)
