"""add_enum_types

Revision ID: add_enum_types
Revises: 01d8b47714c9
Create Date: 2026-03-13

"""
from alembic import op
import sqlalchemy as sa


revision = 'add_enum_types'
down_revision = '01d8b47714c9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create the enum types
    auctionstatus = sa.Enum('draft', 'ready', 'active', 'paused', 'completed', name='auctionstatus')
    playerauctionstatus = sa.Enum('pending', 'active', 'sold', 'unsold', name='playerauctionstatus')
    
    auctionstatus.create(op.get_bind(), checkfirst=True)
    playerauctionstatus.create(op.get_bind(), checkfirst=True)
    
    # For auction_events.status:
    # 1. Drop the default
    # 2. Change the type
    # 3. Re-add the default with enum type
    op.execute("ALTER TABLE auction_events ALTER COLUMN status DROP DEFAULT")
    op.execute("""
        ALTER TABLE auction_events 
        ALTER COLUMN status TYPE auctionstatus 
        USING status::auctionstatus
    """)
    op.execute("ALTER TABLE auction_events ALTER COLUMN status SET DEFAULT 'draft'::auctionstatus")
    
    # For auction_players.status:
    # 1. Drop the default
    # 2. Change the type
    # 3. Re-add the default with enum type
    op.execute("ALTER TABLE auction_players ALTER COLUMN status DROP DEFAULT")
    op.execute("""
        ALTER TABLE auction_players 
        ALTER COLUMN status TYPE playerauctionstatus 
        USING status::playerauctionstatus
    """)
    op.execute("ALTER TABLE auction_players ALTER COLUMN status SET DEFAULT 'pending'::playerauctionstatus")


def downgrade() -> None:
    # Convert back to varchar
    op.execute("""
        ALTER TABLE auction_events 
        ALTER COLUMN status TYPE VARCHAR(50) 
        USING status::text
    """)
    
    op.execute("""
        ALTER TABLE auction_players 
        ALTER COLUMN status TYPE VARCHAR(20) 
        USING status::text
    """)
    
    # Drop the enum types
    op.execute("DROP TYPE IF EXISTS auctionstatus")
    op.execute("DROP TYPE IF EXISTS playerauctionstatus")
