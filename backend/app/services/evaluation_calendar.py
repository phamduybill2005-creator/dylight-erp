"""Vietnam monthly review cycle shared by web and group reminders."""
from datetime import datetime, timedelta, timezone

EVAL_REMINDER_DAY = 1
EVAL_REMINDER_HOUR = 8
EVAL_DEADLINE_DAY = 5


def evaluation_voting_open(month: str, now: datetime) -> bool:
    """Only last month's ballot may change, throughout Vietnam days 1–5."""
    if now.tzinfo is not None:
        now = now.astimezone(timezone(timedelta(hours=7))).replace(tzinfo=None)
    reviewed = now.replace(day=1) - timedelta(days=1)
    return EVAL_REMINDER_DAY <= now.day <= EVAL_DEADLINE_DAY and month == reviewed.strftime("%Y-%m")


def evaluation_window_open(now: datetime) -> bool:
    return (EVAL_REMINDER_DAY <= now.day <= EVAL_DEADLINE_DAY
            and (now.day > EVAL_REMINDER_DAY or now.hour >= EVAL_REMINDER_HOUR))


def evaluation_reminder(now: datetime) -> tuple[str, str, str]:
    """Return reviewed month, title and body; claims still key by sending month."""
    reviewed = now.replace(day=1) - timedelta(days=1)
    title = f"Đánh giá định kì tháng {reviewed:%m/%Y}"
    body = (f"Từ ngày 01 đến hết ngày 05/{now:%m/%Y}, mọi người vào mục Đánh giá "
            f"để chấm đánh giá tháng {reviewed:%m/%Y}.")
    return reviewed.strftime("%Y-%m"), title, body
