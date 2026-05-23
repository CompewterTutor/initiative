"""Widen queue_items.position to NUMERIC(20, 10).

Changes ``queue_items.position`` from INTEGER to NUMERIC(20, 10) so queue
items sharing the same initiative value can be ordered with fractional
midpoint positions (drag-reorder), mirroring counter ``position``.

Revision ID: 20260522_0086
Revises: 20260521_0085
Create Date: 2026-05-22
"""

from alembic import op
import sqlalchemy as sa

revision = "20260522_0086"
down_revision = "20260521_0085"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "queue_items",
        "position",
        existing_type=sa.Integer(),
        type_=sa.Numeric(20, 10),
        existing_nullable=False,
        existing_server_default=sa.text("0"),
        postgresql_using="position::numeric(20, 10)",
    )


def downgrade() -> None:
    op.alter_column(
        "queue_items",
        "position",
        existing_type=sa.Numeric(20, 10),
        type_=sa.Integer(),
        existing_nullable=False,
        existing_server_default=sa.text("0"),
        postgresql_using="round(position)::integer",
    )
