"""Add per-session permissions and source-data confirmations.

Revision ID: f48a11b6c920
Revises: e18c27a6d904
"""
from alembic import op
import sqlalchemy as sa

revision = "f48a11b6c920"
down_revision = "e18c27a6d904"
branch_labels = None
depends_on = None


def upgrade():
    # ERP startup may already create these new tables; never recreate existing data.
    inspector = sa.inspect(op.get_bind())
    if "allowed_arrival_time" not in {c["name"] for c in inspector.get_columns("leave_requests")}:
        op.add_column("leave_requests", sa.Column("allowed_arrival_time", sa.String(5), nullable=True))
    if not inspector.has_table("attendance_session_overrides"):
        op.create_table("attendance_session_overrides",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("company_id", sa.Integer(), sa.ForeignKey("companies.id"), nullable=False),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("work_date", sa.Date(), nullable=False),
            sa.Column("session", sa.String(2), nullable=False),
            sa.Column("decision", sa.String(30), nullable=True),
            sa.Column("reason", sa.Text(), nullable=False),
            sa.Column("approved_by", sa.String(255), nullable=False),
            sa.Column("recorded_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("recorded_by_name", sa.String(255), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("company_id", "user_id", "work_date", "session", name="uq_attendance_session_override"),
        )
        for name in ("company_id", "user_id", "work_date"):
            op.create_index(f"ix_attendance_session_overrides_{name}", "attendance_session_overrides", [name])
    if not inspector.has_table("attendance_data_confirmations"):
        op.create_table("attendance_data_confirmations",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("company_id", sa.Integer(), sa.ForeignKey("companies.id"), nullable=False),
            sa.Column("work_date", sa.Date(), nullable=False),
            sa.Column("session", sa.String(2), nullable=False),
            sa.Column("reason", sa.Text(), nullable=False),
            sa.Column("confirmed_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("confirmed_by_name", sa.String(255), nullable=True),
            sa.Column("confirmed_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("company_id", "work_date", "session", name="uq_attendance_data_confirmation"),
        )
        for name in ("company_id", "work_date"):
            op.create_index(f"ix_attendance_data_confirmations_{name}", "attendance_data_confirmations", [name])


def downgrade():
    op.drop_table("attendance_data_confirmations")
    op.drop_table("attendance_session_overrides")
    op.drop_column("leave_requests", "allowed_arrival_time")
