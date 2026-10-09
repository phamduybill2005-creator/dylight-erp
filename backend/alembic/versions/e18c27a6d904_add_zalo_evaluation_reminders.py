"""Add only durable monthly evaluation reminder claims.

Revision ID: e18c27a6d904
Revises: c72d40e9a615
"""
from alembic import op
import sqlalchemy as sa

revision = "e18c27a6d904"
down_revision = "c72d40e9a615"
branch_labels = None
depends_on = None

TABLE = "zalo_evaluation_reminders"
# Frozen schema; never import application models into historical migrations.
FIELDS = {
    "company_id": (sa.Integer(), False), "period": (sa.String(7), False),
    "oa_id": (sa.String(100), False), "group_id": (sa.String(100), False),
    "status": (sa.String(20), False), "claimed_at": (sa.DateTime(), False),
    "finished_at": (sa.DateTime(), True),
}


def check_schema(connection) -> bool:
    inspector = sa.inspect(connection)
    if not inspector.has_table("companies"):
        raise RuntimeError("Existing ERP companies table is required.")
    if not inspector.has_table(TABLE):
        return False
    columns = {column["name"]: column for column in inspector.get_columns(TABLE)}
    if set(columns) != set(FIELDS):
        raise RuntimeError("Reminder schema column mismatch; manual review required.")
    for name, (expected_type, nullable) in FIELDS.items():
        actual = columns[name]
        if (actual["type"]._type_affinity != expected_type._type_affinity
                or getattr(actual["type"], "length", None) != getattr(expected_type, "length", None)
                or actual["nullable"] != nullable or bool(getattr(actual["type"], "timezone", False))):
            raise RuntimeError("Reminder schema type/nullability mismatch; manual review required.")
    if inspector.get_pk_constraint(TABLE)["constrained_columns"] != ["company_id", "period"]:
        raise RuntimeError("Reminder company/month primary key mismatch; manual review required.")
    foreign_keys = {(tuple(fk["constrained_columns"]), fk["referred_table"], tuple(fk["referred_columns"]))
                    for fk in inspector.get_foreign_keys(TABLE)}
    if foreign_keys != {(("company_id",), "companies", ("id",))}:
        raise RuntimeError("Reminder foreign key mismatch; manual review required.")
    if inspector.get_unique_constraints(TABLE) or inspector.get_indexes(TABLE):
        raise RuntimeError("Reminder indexes/uniqueness mismatch; manual review required.")
    return True


def upgrade() -> None:
    if not op.get_context().as_sql:
        connection = op.get_bind()
        if connection.dialect.name == "postgresql":
            connection.execute(sa.text("SELECT pg_advisory_xact_lock(726102727)"))
        if check_schema(connection):
            return
    op.create_table(TABLE,
        *(sa.Column(name, kind, nullable=nullable) for name, (kind, nullable) in FIELDS.items()),
        sa.PrimaryKeyConstraint("company_id", "period"),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
    )


def downgrade() -> None:
    op.drop_table(TABLE)
