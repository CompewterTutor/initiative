"""Null out Ollama AI settings at guild and user scope.

Ollama is now only configurable at the platform level. Any existing
guild_settings or users rows that selected ollama have their AI override
fields cleared so they fall back to inherited platform settings.

Revision ID: 20260515_0084
Revises: 20260501_0083
Create Date: 2026-05-15
"""

from alembic import op
from sqlalchemy import text

revision = "20260515_0084"
down_revision = "20260501_0083"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        text(
            """
            UPDATE guild_settings
            SET ai_provider = NULL,
                ai_api_key_encrypted = NULL,
                ai_base_url = NULL,
                ai_model = NULL
            WHERE ai_provider = 'ollama'
            """
        )
    )
    op.execute(
        text(
            """
            UPDATE users
            SET ai_provider = NULL,
                ai_api_key_encrypted = NULL,
                ai_base_url = NULL,
                ai_model = NULL
            WHERE ai_provider = 'ollama'
            """
        )
    )


def downgrade() -> None:
    pass
