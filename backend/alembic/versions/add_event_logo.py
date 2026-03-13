"""Add logo column to auction_events

Revision ID: add_event_logo
Revises: add_total_viewers
Create Date: 2026-03-14

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_event_logo'
down_revision = 'add_total_viewers'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('auction_events', sa.Column('logo', sa.String(500), nullable=True))


def downgrade() -> None:
    op.drop_column('auction_events', 'logo')
