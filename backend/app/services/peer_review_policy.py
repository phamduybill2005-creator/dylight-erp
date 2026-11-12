"""Peer scope shared by ballot validation and completion reminders."""
_DEPARTMENTS = {"測量解析": "Phòng Bản đồ", "3次元設計": "Phòng BIM",
                "土木設計": "Phòng Thiết kế đường 2D", "AI開発": "Phòng AI"}


def normalized_departments(value: str | None) -> set[str]:
    return {_DEPARTMENTS.get(part.strip(), part.strip()) for part in (value or "").split(",") if part.strip()}


def can_review_quality(voter_department: str | None, target_department: str | None) -> bool:
    voter_departments = normalized_departments(voter_department)
    return not voter_departments or bool(voter_departments & normalized_departments(target_department))
