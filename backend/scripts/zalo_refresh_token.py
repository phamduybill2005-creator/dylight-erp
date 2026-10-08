"""Check token metadata by default; --refresh explicitly permits contacting Zalo."""
import argparse
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true", help="Allow token refresh if expiry is within five minutes")
    args = parser.parse_args()
    from sqlalchemy import select
    from sqlalchemy.exc import SQLAlchemyError
    from app import models  # Register referenced tables without importing application startup.
    from app.config import settings
    from app.database import SessionLocal
    from app.services.zalo_oauth_service import ZaloError, ZaloOAuthService
    from app.zalo_models import ZaloOACredential

    with SessionLocal() as db:
        oauth = ZaloOAuthService(db)
        try:
            if args.refresh:
                oauth.get_valid_access_token(settings.ZALO_COMPANY_ID)
            row = db.scalar(select(ZaloOACredential).where(ZaloOACredential.company_id == settings.ZALO_COMPANY_ID))
            if row is None:
                print("OA not connected.")
                return 1
            # Never print tokens, encryption keys, verifier or provider responses.
            print(f"oa_id={row.oa_id} status={row.status} expires_at_utc={row.expires_at.isoformat()}")
            return 0
        except (ZaloError, SQLAlchemyError):
            print("OA check/refresh failed. Check backend configuration, schema or reconnect as ERP ADMIN.", file=sys.stderr)
            return 1


if __name__ == "__main__":
    sys.exit(main())
