"""add deleted_at to users for soft delete and normalize emails to lowercase

Revision ID: add_user_deleted_at
Revises: add_event_logo
Create Date: 2026-03-14

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_user_deleted_at'
down_revision: Union[str, None] = 'add_event_logo'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add deleted_at column for soft delete
    op.add_column('users', sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True))
    
    # Normalize all existing emails to lowercase
    op.execute("UPDATE users SET email = LOWER(email)")


def downgrade() -> None:
    op.drop_column('users', 'deleted_at')
    # Note: Cannot reverse email lowercase normalization
