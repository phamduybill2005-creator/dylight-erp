"""GMF discovery and text sending, reused by the manual announcement service."""
from app.services.zalo_oauth_service import ZaloError, ZaloOAuthService

GROUPS_URL = "https://openapi.zalo.me/v3.0/oa/group/getgroupsofoa"
MESSAGE_URL = "https://openapi.zalo.me/v3.0/oa/group/message"


class ZaloOAService:
    def __init__(self, oauth: ZaloOAuthService):
        self.oauth = oauth

    def list_groups(self, company_id: int, offset: int = 0, count: int = 5) -> dict:
        if offset < 0 or not 1 <= count <= 100:
            raise ZaloError(422, "Phân trang nhóm không hợp lệ.")
        access_token = self.oauth.get_valid_access_token(company_id)
        payload = self.oauth.request_json("GET", GROUPS_URL, params={"offset": offset, "count": count},
                                          headers={"access_token": access_token})
        data = payload.get("data")
        if not isinstance(data, dict) or not isinstance(data.get("groups"), list):
            raise ZaloError(502, "Dữ liệu danh sách nhóm từ Zalo không hợp lệ.")
        groups = []
        for group in data["groups"]:
            if not isinstance(group, dict) or not isinstance(group.get("group_id"), str):
                raise ZaloError(502, "Dữ liệu nhóm từ Zalo không hợp lệ.")
            # Explicit allowlist: never forward a raw provider response.
            groups.append({key: group.get(key) for key in ("group_id", "name", "status", "total_member")})
        return {"oa_id": self.oauth.config.ZALO_OA_ID, "offset": data.get("offset", offset),
                "count": data.get("count", count), "total": data.get("total"), "groups": groups}

    def send_gmf_message(self, group_id: str, message: str) -> dict:
        if not isinstance(group_id, str) or not group_id.strip() or not isinstance(message, str) or not message.strip():
            raise ZaloError(422, "Cần group_id và nội dung tin nhắn.")
        access_token = self.oauth.get_valid_access_token(self.oauth.config.ZALO_COMPANY_ID)
        payload = self.oauth.request_json("POST", MESSAGE_URL, headers={"access_token": access_token},
                                          json={"recipient": {"group_id": group_id}, "message": {"text": message}})
        data = payload.get("data")
        if not isinstance(data, dict) or not isinstance(data.get("message_id"), str):
            raise ZaloError(502, "Dữ liệu gửi tin từ Zalo không hợp lệ.")
        return {"group_id": data.get("group_id"), "message_id": data["message_id"]}
