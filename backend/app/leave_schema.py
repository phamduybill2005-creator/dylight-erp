"""Additive compatibility upgrade for databases created with create_all."""
from sqlalchemy import inspect, text
from sqlalchemy.dialects.postgresql import ENUM


def ensure_leave_canceled_status(engine):
    """Commit the new enum label before any request can write it; preserve all rows."""
    if engine.dialect.name != "postgresql":
        return
    with engine.begin() as connection:
        inspector = inspect(connection)
        if not inspector.has_table("leave_requests"):
            return
        status_type = next(column["type"] for column in inspector.get_columns("leave_requests")
                           if column["name"] == "status")
        # Some legacy databases store statuses as VARCHAR(8). CANCELED fits the
        # existing length; those need no DDL. Fresh enums already have the label.
        if not isinstance(status_type, ENUM) or "CANCELED" in status_type.enums:
            return
        quote = engine.dialect.identifier_preparer.quote
        name = quote(status_type.name)
        if status_type.schema:
            name = f"{quote(status_type.schema)}.{name}"
        connection.execute(text(f"ALTER TYPE {name} ADD VALUE IF NOT EXISTS 'CANCELED'"))
