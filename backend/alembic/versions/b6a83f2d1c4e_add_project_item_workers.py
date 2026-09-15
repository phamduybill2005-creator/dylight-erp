"""add project item workers

Revision ID: b6a83f2d1c4e
Revises: d094beace22e
Create Date: 2026-09-15
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b6a83f2d1c4e"
down_revision: Union[str, None] = "d094beace22e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "project_item_workers",
        sa.Column("project_item_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["project_item_id"], ["project_items.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("project_item_id", "user_id"),
    )


def downgrade() -> None:
    op.drop_table("project_item_workers")
