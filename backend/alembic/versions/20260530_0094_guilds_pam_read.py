"""Allow a PAM grantee to read the granted guild's own row.

A guild grant deliberately doesn't expose identity/config tables (memberships,
settings, invites, oidc), but the grantee must still be able to SELECT the
``guilds`` row itself to enter the guild — ``get_guild_membership`` fetches it
to build the request's GuildContext. Without this, every guild-scoped endpoint
500s for a grantee (get_guild raises GUILD_NOT_FOUND under RLS).

Additive PERMISSIVE FOR SELECT policy keyed on the pam session vars; matches
only the granted guild while a grant is active, so normal access is unchanged.

Revision ID: 20260530_0094
Revises: 20260530_0093
Create Date: 2026-05-30
"""

from alembic import op
from sqlalchemy import text


revision = "20260530_0094"
down_revision = "20260530_0093"
branch_labels = None
depends_on = None

PAM_GUILD = "NULLIF(current_setting('app.pam_guild_id', true), '')::int"
PAM_READ = "current_setting('app.pam_read', true) = 'true'"


def upgrade() -> None:
    op.get_bind().execute(text(
        f"CREATE POLICY guilds_pam_read ON guilds FOR SELECT "
        f"USING (id = {PAM_GUILD} AND {PAM_READ})"
    ))


def downgrade() -> None:
    op.get_bind().execute(text("DROP POLICY IF EXISTS guilds_pam_read ON guilds"))
