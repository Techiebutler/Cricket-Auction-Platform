"""Add total_viewers column to auction_events

Revision ID: add_total_viewers
Revises: add_enum_types
Create Date: 2026-03-13
"""
from alembic import op
import sqlalchemy as sa


revision = "add_total_viewers"
down_revision = "add_enum_types"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "auction_events",
        sa.Column("total_viewers", sa.Integer(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("auction_events", "total_viewers")
