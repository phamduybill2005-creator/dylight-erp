"""Zalo OA OAuth v4. Network calls contain secrets only in headers/form bodies."""
import base64
import hashlib
import secrets
from datetime import datetime, timedelta
from urllib.parse import urlencode, urlsplit

import httpx
from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.config import Settings, settings
from app.models import User, UserRole
from app.zalo_models import ZaloOAuthTransaction
from app.services.zalo_repository import ZaloRepository, utc_now

AUTHORIZATION_URL = "https://oauth.zaloapp.com/v4/oa/permission"
TOKEN_URL = "https://oauth.zaloapp.com/v4/oa/access_token"
OAUTH_TTL = 15 * 60
REFRESH_MARGIN = timedelta(minutes=5)


class ZaloError(Exception):
    """Only static, safe error messages may cross the service boundary."""
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


class ZaloOAuthService:
    def __init__(self, db: Session, config: Settings = settings, client: httpx.Client | None = None):
        self.db, self.config, self.client = db, config, client

    def repository(self) -> ZaloRepository:
        cfg = self.config
        if not cfg.ZALO_ENABLED:
            raise ZaloError(503, "Tích hợp Zalo chưa được bật.")
        try:
            parsed = urlsplit(cfg.ZALO_OA_CALLBACK_URL)
            valid_url = (parsed.scheme == "https" and parsed.hostname and not parsed.username
                         and not parsed.password and parsed.path == "/api/zalo/callback"
                         and not parsed.query and not parsed.fragment and parsed.port in (None, 443))
        except ValueError:
            valid_url = False
        if (not cfg.ZALO_APP_ID.isascii() or not cfg.ZALO_APP_ID.isdecimal()
                or not cfg.ZALO_OA_ID.isascii() or not cfg.ZALO_OA_ID.isdecimal()
                or not cfg.ZALO_APP_SECRET.get_secret_value() or cfg.ZALO_COMPANY_ID <= 0 or not valid_url):
            raise ZaloError(503, "Cấu hình backend Zalo chưa đầy đủ hoặc chưa hợp lệ.")
        try:
            cipher = Fernet(cfg.ZALO_TOKEN_ENCRYPTION_KEY.get_secret_value().encode())
        except (ValueError, TypeError):
            raise ZaloError(503, "Khóa mã hóa token Zalo chưa hợp lệ.") from None
        return ZaloRepository(self.db, cipher)

    def check_company(self, company_id: int) -> None:
        if company_id != self.config.ZALO_COMPANY_ID:
            raise ZaloError(403, "OA này không được cấu hình cho công ty của bạn.")

    @staticmethod
    def check_admin(admin: User | None, company_id: int, token_version: int) -> None:
        if (admin is None or admin.role != UserRole.ADMIN or not admin.is_active or not admin.is_approved
                or admin.company_id != company_id or (admin.token_version or 0) != token_version):
            raise ZaloError(403, "Quyền quản trị không hợp lệ hoặc đã thay đổi. Hãy kết nối lại.")

    def begin(self, admin: User) -> tuple[str, str]:
        repo = self.repository()
        self.check_company(admin.company_id)
        self.check_admin(admin, admin.company_id, admin.token_version or 0)
        state, binding = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        # SDK-compatible 43-character verifier; ensure all character classes documented by Zalo.
        while True:
            verifier = secrets.token_urlsafe(32)
            if any(c.isupper() for c in verifier) and any(c.islower() for c in verifier) and any(c.isdigit() for c in verifier):
                break
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest()).decode().rstrip("=")
        now = utc_now()
        repo.create_attempt(ZaloOAuthTransaction(
            state_hash=digest(state), browser_hash=digest(binding), company_id=admin.company_id,
            admin_id=admin.id, token_version=admin.token_version or 0, app_id=self.config.ZALO_APP_ID,
            oa_id=self.config.ZALO_OA_ID, callback_url=self.config.ZALO_OA_CALLBACK_URL,
            code_verifier_encrypted=repo.encrypt(verifier), created_at=now,
            expires_at=now + timedelta(seconds=OAUTH_TTL), status="pending",
        ))
        return AUTHORIZATION_URL + "?" + urlencode(dict(
            app_id=self.config.ZALO_APP_ID, redirect_uri=self.config.ZALO_OA_CALLBACK_URL,
            code_challenge=challenge, state=state,
        )), binding

    def complete(self, code: str, state: str, oa_id: str, binding: str) -> dict:
        repo = self.repository()
        if not code or not state or not binding or len(state) > 128 or len(binding) > 128 or len(code) > 4096:
            raise ZaloError(400, "Callback OAuth không hợp lệ hoặc đã hết hạn.")
        attempt = repo.get_attempt(digest(state))
        if (attempt is None or attempt.status != "pending" or attempt.consumed_at is not None
                or attempt.expires_at <= utc_now() or not attempt.code_verifier_encrypted
                or not secrets.compare_digest(attempt.browser_hash, digest(binding))
                or oa_id != self.config.ZALO_OA_ID or oa_id != attempt.oa_id
                or attempt.app_id != self.config.ZALO_APP_ID
                or attempt.callback_url != self.config.ZALO_OA_CALLBACK_URL
                or attempt.company_id != self.config.ZALO_COMPANY_ID):
            raise ZaloError(400, "Callback OAuth không hợp lệ hoặc đã hết hạn.")
        admin_id, company_id, version = attempt.admin_id, attempt.company_id, attempt.token_version
        # Bind credentials to the transaction's OA after validating the callback against configuration.
        validated_oa_id, app_id = attempt.oa_id, attempt.app_id
        self.check_admin(self.db.get(User, admin_id, populate_existing=True), company_id, version)
        try:
            verifier = repo.decrypt(attempt.code_verifier_encrypted)
        except (InvalidToken, UnicodeError):
            raise ZaloError(503, "Không giải mã được phiên OAuth. Hãy khởi tạo kết nối lại.") from None
        state_hash = attempt.state_hash
        if not repo.consume_attempt(state_hash, digest(binding)):
            raise ZaloError(400, "Callback OAuth đã được sử dụng hoặc đã hết hạn.")
        access, refresh, expires_at = self._exchange(dict(
            code=code, app_id=self.config.ZALO_APP_ID, grant_type="authorization_code", code_verifier=verifier,
        ))
        self.check_admin(self.db.get(User, admin_id, populate_existing=True), company_id, version)
        if not repo.save_connection(state_hash, company_id, validated_oa_id, app_id, access, refresh, expires_at):
            raise ZaloError(409, "Đã có phiên kết nối mới hơn. Hãy dùng đường dẫn cấp quyền mới nhất.")
        return {"status": "connected", "oa_id": validated_oa_id}

    def get_valid_access_token(self, company_id: int) -> str:
        repo = self.repository()
        self.check_company(company_id)
        row = repo.get_credentials(company_id)
        if row is None or row.oa_id != self.config.ZALO_OA_ID or row.app_id != self.config.ZALO_APP_ID:
            raise ZaloError(409, "OA chưa được kết nối. Quản trị viên cần cấp quyền.")
        if row.status != "active":
            raise ZaloError(409, "OA đang refresh hoặc cần quản trị viên kết nối lại.")
        try:
            if row.expires_at > utc_now() + REFRESH_MARGIN:
                return repo.decrypt(row.access_token_encrypted)
            credential_id, generation = row.id, row.generation
            refresh_token = repo.decrypt(row.refresh_token_encrypted)
        except (InvalidToken, UnicodeError):
            raise ZaloError(503, "Không giải mã được token OA. Kiểm tra khóa mã hóa backend.") from None
        if not repo.claim_refresh(credential_id, generation):
            raise ZaloError(409, "Token OA đang được cập nhật. Hãy thử lại sau.")
        try:
            access, refresh, expires_at = self._exchange(dict(
                app_id=self.config.ZALO_APP_ID, refresh_token=refresh_token, grant_type="refresh_token",
            ))
            if not repo.finish_refresh(credential_id, generation, access, refresh, expires_at):
                raise ZaloError(409, "Kết nối OA đã thay đổi. Hãy thử lại sau.")
        except (ZaloError, SQLAlchemyError):
            try:
                repo.fail_refresh(credential_id, generation)
            except SQLAlchemyError:
                # Durable 'refreshing' remains; don't reuse the refresh token on the next request.
                self.db.rollback()
            raise ZaloError(409, "Refresh OA chưa hoàn tất. Quản trị viên cần kiểm tra hoặc kết nối lại.") from None
        return access

    def _exchange(self, data: dict) -> tuple[str, str, datetime]:
        issued_at = utc_now()
        payload = self.request_json("POST", TOKEN_URL, data=data, headers={
            "secret_key": self.config.ZALO_APP_SECRET.get_secret_value(),
        })
        access, refresh, expires = payload.get("access_token"), payload.get("refresh_token"), payload.get("expires_in")
        try:
            if isinstance(expires, bool) or not isinstance(expires, (int, str)):
                raise ValueError
            seconds = int(expires)
            if (not isinstance(access, str) or not access or not isinstance(refresh, str) or not refresh
                    or not 0 < seconds <= 366 * 86400):
                raise ValueError
        except (ValueError, TypeError):
            raise ZaloError(502, "Zalo trả về dữ liệu token không hợp lệ.") from None
        return access, refresh, issued_at + timedelta(seconds=seconds)

    def request_json(self, method: str, url: str, **kwargs) -> dict:
        # No provider payloads, HTTP exceptions, request bodies or token headers in logs/responses.
        try:
            if self.client is not None:
                response = self.client.request(method, url, timeout=10, follow_redirects=False, **kwargs)
            else:
                with httpx.Client(timeout=10, follow_redirects=False, trust_env=False) as client:
                    response = client.request(method, url, **kwargs)
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError):
            raise ZaloError(502, "Không nhận được phản hồi hợp lệ từ Zalo.") from None
        if not isinstance(payload, dict) or payload.get("error", 0) != 0:
            raise ZaloError(502, "Zalo từ chối yêu cầu. Kiểm tra cấp quyền hoặc kết nối lại OA.")
        return payload
