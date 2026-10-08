"""Remove the OAuth callback query from Uvicorn access logs, including slash redirects."""
import logging
from urllib.parse import unquote, urlsplit


class ZaloCallbackLogFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple) and len(record.args) == 5:
            args = list(record.args)
            target = str(args[2])
            try:
                path = urlsplit(target).path
            except ValueError:
                path = target.split("?", 1)[0]
            if unquote(path).rstrip("/") == "/api/zalo/callback":
                args[2] = "/api/zalo/callback"
                record.args = tuple(args)
        return True


def install_callback_log_filter() -> None:
    logger = logging.getLogger("uvicorn.access")
    if not any(isinstance(f, ZaloCallbackLogFilter) for f in logger.filters):
        logger.addFilter(ZaloCallbackLogFilter())
