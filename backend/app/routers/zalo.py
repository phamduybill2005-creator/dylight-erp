"""Thin admin routes. Public callback is secured by the server's OAuth transaction."""
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_roles
from app.models import User, UserRole
from app.services.zalo_oauth_service import OAUTH_TTL, ZaloError, ZaloOAuthService
from app.services.zalo_oa_service import ZaloOAService

COOKIE_NAME = "__Host-dosco_zalo_oauth"


class ZaloSafeRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def safe_handler(request: Request):
            try:
                response = await handler(request)
            except ZaloError as exc:
                response = JSONResponse({"detail": str(exc)}, status_code=exc.status_code)
            except HTTPException as exc:
                response = JSONResponse({"detail": exc.detail}, status_code=exc.status_code, headers=exc.headers)
            except RequestValidationError:
                # FastAPI's default detail includes input values: never reflect an OAuth code.
                response = JSONResponse({"detail": "Tham số Zalo không hợp lệ."}, status_code=422)
            except SQLAlchemyError:
                response = JSONResponse({"detail": "Kho lưu trữ Zalo chưa sẵn sàng. Kiểm tra migration backend."},
                                        status_code=503)
            response.headers["Cache-Control"] = "no-store"
            response.headers["Referrer-Policy"] = "no-referrer"
            return response

        return safe_handler


router = APIRouter(prefix="/api/zalo", tags=["Zalo OA"], route_class=ZaloSafeRoute)


def get_zalo_service(db: Session = Depends(get_db)) -> ZaloOAuthService:
    return ZaloOAuthService(db)


@router.post("/authorize")
def authorize(request: Request, admin: User = Depends(require_roles(UserRole.ADMIN)),
              oauth: ZaloOAuthService = Depends(get_zalo_service)):
    oauth.repository()  # Disabled/incomplete integration fails without changing cookies or DB.
    callback = urlsplit(oauth.config.ZALO_OA_CALLBACK_URL)
    origin = f"{callback.scheme}://{callback.netloc}"
    if request.headers.get("host", "").lower() != callback.netloc.lower() or (
            request.headers.get("origin") is not None and request.headers["origin"] != origin):
        raise ZaloError(400, "Khởi tạo OAuth qua đúng domain callback HTTPS của ERP.")
    url, binding = oauth.begin(admin)
    response = JSONResponse({"authorization_url": url, "expires_in": OAUTH_TTL})
    response.set_cookie(COOKIE_NAME, binding, max_age=OAUTH_TTL, secure=True, httponly=True, samesite="lax", path="/")
    return response


@router.get("/callback")
def callback(request: Request, oauth: ZaloOAuthService = Depends(get_zalo_service)):
    # Reject ambiguous duplicate parameters; process only values issued for this attempt.
    if any(len(request.query_params.getlist(key)) > 1 for key in ("code", "state", "oa_id")):
        raise ZaloError(400, "Callback OAuth không hợp lệ.")
    result = oauth.complete(request.query_params.get("code", ""), request.query_params.get("state", ""),
                            request.query_params.get("oa_id", ""), request.cookies.get(COOKIE_NAME, ""))
    response = JSONResponse(result)
    response.delete_cookie(COOKIE_NAME, path="/", secure=True, httponly=True, samesite="lax")
    return response


@router.get("/groups")
def groups(offset: int = Query(0, ge=0), count: int = Query(5, ge=1, le=100),
           admin: User = Depends(require_roles(UserRole.ADMIN)), oauth: ZaloOAuthService = Depends(get_zalo_service)):
    oauth.repository()
    oauth.check_company(admin.company_id)
    return ZaloOAService(oauth).list_groups(admin.company_id, offset, count)
