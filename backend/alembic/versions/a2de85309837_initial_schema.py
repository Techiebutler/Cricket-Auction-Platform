"""initial_schema

Revision ID: a2de85309837
Revises: 
Create Date: 2026-03-12 19:17:54.313525

"""
from alembic import op
import sqlalchemy as sa


revision = 'a2de85309837'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Core user table
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False, unique=True, index=True),
        sa.Column("phone", sa.String(length=20), nullable=True),
        sa.Column("hashed_password", sa.String(length=255), nullable=False),
        sa.Column("roles", sa.ARRAY(sa.String()), nullable=False, server_default=sa.text("ARRAY['player']::varchar[]")),
        sa.Column("profile_photo", sa.String(length=500), nullable=True),
        sa.Column("batting_rating", sa.Float(), nullable=False, server_default="5.0"),
        sa.Column("bowling_rating", sa.Float(), nullable=False, server_default="5.0"),
        sa.Column("fielding_rating", sa.Float(), nullable=False, server_default="5.0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("onboarded", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )

    # Auction events
    op.create_table(
        "auction_events",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("admin_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("organizer_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("auctioneer_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False, server_default="draft"),
        sa.Column("allowed_domains", sa.ARRAY(sa.String()), nullable=False, server_default=sa.text("ARRAY[]::varchar[]")),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )

    # Teams
    op.create_table(
        "teams",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("event_id", sa.Integer(), sa.ForeignKey("auction_events.id"), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("color", sa.String(length=7), nullable=False, server_default="#3B82F6"),
        sa.Column("captain_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("budget", sa.Integer(), nullable=False, server_default="1000"),
        sa.Column("spent", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("max_players", sa.Integer(), nullable=False, server_default="11"),
    )

    # Team players
    op.create_table(
        "team_players",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("team_id", sa.Integer(), sa.ForeignKey("teams.id"), nullable=False),
        sa.Column("player_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("sold_price", sa.Integer(), nullable=False, server_default="0"),
    )

    # Auction players
    op.create_table(
        "auction_players",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("event_id", sa.Integer(), sa.ForeignKey("auction_events.id"), nullable=False),
        sa.Column("player_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("base_price", sa.Integer(), nullable=False, server_default="100"),
        sa.Column("current_bid", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("current_bidder_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("auction_order", sa.Integer(), nullable=False, server_default="0"),
    )

    # Bids
    op.create_table(
        "bids",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("event_id", sa.Integer(), sa.ForeignKey("auction_events.id"), nullable=False),
        sa.Column("auction_player_id", sa.Integer(), sa.ForeignKey("auction_players.id"), nullable=False),
        sa.Column("captain_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )


def downgrade() -> None:
    op.drop_table("bids")
    op.drop_table("auction_players")
    op.drop_table("team_players")
    op.drop_table("teams")
    op.drop_table("auction_events")
    op.drop_table("users")
