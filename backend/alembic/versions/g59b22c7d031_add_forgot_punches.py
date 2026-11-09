"""Add explicit forgotten-punch confirmations independent from real clocks.

Revision ID: g59b22c7d031
Revises: f48a11b6c920
"""
from alembic import op
import sqlalchemy as sa

revision = "g59b22c7d031"
down_revision = "f48a11b6c920"
branch_labels = None
depends_on = None


def upgrade():
    # Startup create_all may already have created this table and live records.
    if sa.inspect(op.get_bind()).has_table("attendance_forgot_punches"):
        return
    op.create_table("attendance_forgot_punches",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("company_id", sa.Integer(), sa.ForeignKey("companies.id"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("work_date", sa.Date(), nullable=False),
        sa.Column("punch", sa.String(3), nullable=False),
        sa.Column("decision", sa.String(30), nullable=True),
        sa.Column("reported_at", sa.DateTime(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("approved_by", sa.String(255), nullable=False),
        sa.Column("recorded_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("recorded_by_name", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("company_id", "user_id", "work_date", "punch", name="uq_attendance_forgot_punch"),
    )
    for name in ("company_id", "user_id", "work_date"):
        op.create_index(f"ix_attendance_forgot_punches_{name}", "attendance_forgot_punches", [name])


def downgrade():
    if sa.inspect(op.get_bind()).has_table("attendance_forgot_punches"):
        op.drop_table("attendance_forgot_punches")
