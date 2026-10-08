"""Add only Zalo's private OAuth tables; safe for legacy create_all databases.

Revision ID: c72d40e9a615
Revises: b6a83f2d1c4e
"""
from alembic import op
import sqlalchemy as sa

revision = "c72d40e9a615"
down_revision = "b6a83f2d1c4e"
branch_labels = None
depends_on = None

# Frozen schema: do not import current application models into a historical revision.
SPECS = {
    "zalo_oauth_transactions": {
        "state_hash": (sa.String(64), False), "browser_hash": (sa.String(64), False),
        "company_id": (sa.Integer(), False), "admin_id": (sa.Integer(), False),
        "token_version": (sa.Integer(), False), "app_id": (sa.String(100), False),
        "oa_id": (sa.String(100), False), "callback_url": (sa.Text(), False),
        "code_verifier_encrypted": (sa.Text(), True), "created_at": (sa.DateTime(), False),
        "expires_at": (sa.DateTime(), False), "consumed_at": (sa.DateTime(), True),
        "status": (sa.String(30), False),
    },
    "zalo_oa_credentials": {
        "id": (sa.Integer(), False), "company_id": (sa.Integer(), False),
        "oa_id": (sa.String(100), False), "app_id": (sa.String(100), False),
        "access_token_encrypted": (sa.Text(), False), "refresh_token_encrypted": (sa.Text(), False),
        "expires_at": (sa.DateTime(), False), "updated_at": (sa.DateTime(), False),
        "generation": (sa.String(32), False), "status": (sa.String(30), False),
    },
}


def check_schema(connection) -> bool:
    """Read-only: absent -> False; compatible -> True; partial/mismatch -> error."""
    inspector = sa.inspect(connection)
    tables = set(inspector.get_table_names())
    present = tables.intersection(SPECS)
    if not present:
        if not {"companies", "users"}.issubset(tables):
            raise RuntimeError("Existing ERP companies/users tables are required.")
        return False
    if present != set(SPECS):
        raise RuntimeError("Partial Zalo schema; manual database review required.")
    for name, fields in SPECS.items():
        columns = {column["name"]: column for column in inspector.get_columns(name)}
        if set(columns) != set(fields):
            raise RuntimeError("Zalo schema column mismatch; manual database review required.")
        for field, (expected_type, nullable) in fields.items():
            column = columns[field]
            actual_type = column["type"]
            if (actual_type._type_affinity != expected_type._type_affinity
                    or getattr(actual_type, "length", None) != getattr(expected_type, "length", None)
                    or column["nullable"] != nullable
                    or bool(getattr(actual_type, "timezone", False))):
                raise RuntimeError("Zalo schema type/nullability mismatch; manual database review required.")
        expected_pk = ["state_hash"] if name == "zalo_oauth_transactions" else ["id"]
        if inspector.get_pk_constraint(name)["constrained_columns"] != expected_pk:
            raise RuntimeError("Zalo primary key mismatch; manual database review required.")
        foreign_keys = {(tuple(fk["constrained_columns"]), fk["referred_table"], tuple(fk["referred_columns"]))
                        for fk in inspector.get_foreign_keys(name)}
        expected_fk = {(("company_id",), "companies", ("id",))}
        if name == "zalo_oauth_transactions":
            expected_fk.add((("admin_id",), "users", ("id",)))
        if foreign_keys != expected_fk:
            raise RuntimeError("Zalo foreign key mismatch; manual database review required.")
        unique = {tuple(item["column_names"]) for item in inspector.get_unique_constraints(name)}
        expected_unique = {("company_id",), ("oa_id",)} if name == "zalo_oa_credentials" else set()
        if unique != expected_unique:
            raise RuntimeError("Zalo uniqueness mismatch; manual database review required.")
        indexes = {(tuple(item["column_names"]), bool(item["unique"]))
                   for item in inspector.get_indexes(name) if not item.get("duplicates_constraint")}
        expected_indexes = {(("company_id",), False), (("expires_at",), False)} if name == "zalo_oauth_transactions" else set()
        if indexes != expected_indexes:
            raise RuntimeError("Zalo indexes mismatch; manual database review required.")
    return True


def upgrade() -> None:
    if not op.get_context().as_sql:
        connection = op.get_bind()
        if connection.dialect.name == "postgresql":
            # Transaction-scoped lock serializes this revision/helper across containers.
            connection.execute(sa.text("SELECT pg_advisory_xact_lock(726040915)"))
        if check_schema(connection):
            return
    op.create_table("zalo_oauth_transactions",
        *(sa.Column(name, kind, nullable=nullable) for name, (kind, nullable) in SPECS["zalo_oauth_transactions"].items()),
        sa.PrimaryKeyConstraint("state_hash"),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["admin_id"], ["users.id"]),
    )
    op.create_index("ix_zalo_oauth_transactions_company_id", "zalo_oauth_transactions", ["company_id"])
    op.create_index("ix_zalo_oauth_transactions_expires_at", "zalo_oauth_transactions", ["expires_at"])
    op.create_table("zalo_oa_credentials",
        *(sa.Column(name, kind, nullable=nullable) for name, (kind, nullable) in SPECS["zalo_oa_credentials"].items()),
        sa.PrimaryKeyConstraint("id"), sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.UniqueConstraint("company_id", name="uq_zalo_oa_credentials_company_id"),
        sa.UniqueConstraint("oa_id", name="uq_zalo_oa_credentials_oa_id"),
    )


def downgrade() -> None:
    op.drop_table("zalo_oa_credentials")
    op.drop_index("ix_zalo_oauth_transactions_expires_at", table_name="zalo_oauth_transactions")
    op.drop_index("ix_zalo_oauth_transactions_company_id", table_name="zalo_oauth_transactions")
    op.drop_table("zalo_oauth_transactions")
