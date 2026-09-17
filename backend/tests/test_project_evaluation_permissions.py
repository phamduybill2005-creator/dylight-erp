"""Quyền sửa ô `evaluation` (JSON Phòng Bản đồ) ngay trên bảng Dự án.

Luật (xem update_project ở app/routers/projects.py):
- Người CÙNG PHÒNG BAN với dự án (không cần quyền quản lý) được sửa MỖI ô
  `evaluation` (nhập Analysis / Vùng) — gửi kèm trường khác là bị chặn.
- Ô tích DATA / TRACE (nằm trong JSON): CHỈ chủ trì dự án, Quản trị hệ thống,
  Giám đốc được đổi; quản lý các cấp sửa ô khác thì phải giữ nguyên 2 ô này.

Chạy từ thư mục backend: python -m unittest tests.test_project_evaluation_permissions -v
"""
import json
import os
import unittest

os.environ["DATABASE_URL"] = "sqlite+pysqlite:///:memory:"
os.environ["DEBUG"] = "true"

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.deps import get_current_user
from app.models import Company, Project, User, UserRole
from app.routers.projects import router

BANDO = "Phòng Bản đồ"


def bando_json(**over) -> str:
    """JSON Phòng Bản đồ như frontend lưu; dữ liệu cũ: data/trace = "0", analysis kèm 'ha'."""
    base = {
        "vung": "", "riegl": "2", "qlcl": "", "data": "0", "analysis": "28.5 ha",
        "trace": "0", "section": "", "tieu_de": "DDM",
    }
    base.update(over)
    return json.dumps(base)


class ProjectEvaluationPermissionTests(unittest.TestCase):
    """1 dự án Phòng Bản đồ (nhóm 測量解析) có chủ trì; thử từng vai trò sửa `evaluation`."""

    def setUp(self):
        self.engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)

        with self.sessions() as db:
            company = Company(name="Test company", code="TEST-EVAL-PERM")
            db.add(company)
            db.flush()

            def mk(email: str, name: str, role: UserRole, dept: str | None = None) -> User:
                return User(
                    company_id=company.id, email=email, full_name=name,
                    role=role, hashed_password="unused", department=dept,
                )

            self.admin = mk("admin@example.com", "Quan tri", UserRole.ADMIN)
            self.director = mk("gd@example.com", "Giam doc", UserRole.DIRECTOR)
            self.senior = mk("qlcc@example.com", "QL cap cao", UserRole.MANAGER, BANDO)
            self.mid = mk("qlct@example.com", "QL cap trung", UserRole.MANAGER_MID, BANDO)
            self.lead = mk("lead@example.com", "Chu tri", UserRole.FIELD_STAFF, BANDO)
            self.staff = mk("nv@example.com", "Nhan vien ban do", UserRole.FIELD_STAFF, BANDO)
            self.other = mk("khac@example.com", "Nhan vien phong khac", UserRole.FIELD_STAFF,
                            "Phòng Thiết kế đường 2D")
            db.add_all([self.admin, self.director, self.senior, self.mid,
                        self.lead, self.staff, self.other])
            db.flush()
            self.mid.manager_id = self.senior.id   # cấp trung CÓ sếp -> không phải cấp cao
            project = Project(
                company_id=company.id, code="2739-0124", name="Du an ban do",
                group_name="測量解析", lead_id=self.lead.id, evaluation=bando_json(),
            )
            db.add(project)
            db.flush()
            self.project_id = project.id
            db.commit()

        self.app = FastAPI()
        self.app.include_router(router)
        self.app.dependency_overrides[get_db] = self._override_db
        self.current = self.staff
        self.app.dependency_overrides[get_current_user] = lambda: self._reload(self.current)
        self.client = TestClient(self.app)

    def tearDown(self):
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def _override_db(self):
        db = self.sessions()
        try:
            yield db
        finally:
            db.close()

    def _reload(self, user: User) -> User:
        with self.sessions() as db:
            return db.get(User, user.id)

    def _patch(self, user: User, body: dict):
        self.current = user
        return self.client.patch(f"/projects/{self.project_id}", json=body)

    def _evaluation(self) -> str | None:
        with self.sessions() as db:
            return db.get(Project, self.project_id).evaluation

    # --- Người cùng phòng ban (không có quyền quản lý) ---------------------------------

    def test_nhan_vien_cung_phong_sua_analysis_duoc(self):
        body = {"evaluation": bando_json(analysis="30")}
        r = self._patch(self.staff, body)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self._evaluation(), body["evaluation"])

    def test_nhan_vien_cung_phong_khong_duoc_sua_truong_khac(self):
        r = self._patch(self.staff, {"evaluation": bando_json(analysis="30"), "name": "Doi ten"})
        self.assertEqual(r.status_code, 403, r.text)
        r = self._patch(self.staff, {"name": "Doi ten"})
        self.assertEqual(r.status_code, 403, r.text)
        self.assertEqual(self._evaluation(), bando_json())

    def test_nhan_vien_phong_khac_bi_chan(self):
        r = self._patch(self.other, {"evaluation": bando_json(analysis="30")})
        self.assertEqual(r.status_code, 403, r.text)

    def test_ghi_chu_chu_thuong_van_sua_duoc(self):
        # Không phải JSON -> coi như chưa tích -> nhân viên cùng phòng vẫn sửa được.
        r = self._patch(self.staff, {"evaluation": "Ghi chú thường"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self._evaluation(), "Ghi chú thường")

    # --- Ô tích DATA / TRACE ---------------------------------------------------------

    def test_khong_phai_chu_tri_admin_giam_doc_thi_khong_duoc_tich(self):
        for user in (self.staff, self.mid, self.senior):
            for key in ("data", "trace"):
                r = self._patch(user, {"evaluation": bando_json(**{key: "1"})})
                self.assertEqual(r.status_code, 403, f"{user.email}/{key}: {r.text}")
        self.assertEqual(self._evaluation(), bando_json())

    def test_quan_ly_sua_o_khac_giu_nguyen_tich_thi_duoc(self):
        for user in (self.mid, self.senior):
            body = {"evaluation": bando_json(analysis="31", vung="Kyushu")}
            r = self._patch(user, body)
            self.assertEqual(r.status_code, 200, f"{user.email}: {r.text}")
            self.assertEqual(self._evaluation(), body["evaluation"])

    def test_chu_tri_admin_giam_doc_duoc_tich_va_bo_tich(self):
        for user in (self.lead, self.admin, self.director):
            r = self._patch(user, {"evaluation": bando_json(data="1", trace="1")})
            self.assertEqual(r.status_code, 200, f"{user.email}: {r.text}")
            self.assertEqual(self._evaluation(), bando_json(data="1", trace="1"))
            r = self._patch(user, {"evaluation": bando_json()})
            self.assertEqual(r.status_code, 200, f"{user.email}: {r.text}")
            self.assertEqual(self._evaluation(), bando_json())

    def test_da_tich_thi_nhan_vien_khong_bo_tich_duoc_nhung_van_sua_analysis(self):
        # Dữ liệu cũ: DATA nhập số "12" (khác 0) = đã tích.
        r = self._patch(self.admin, {"evaluation": bando_json(data="12")})
        self.assertEqual(r.status_code, 200, r.text)
        r = self._patch(self.staff, {"evaluation": bando_json(data="")})
        self.assertEqual(r.status_code, 403, r.text)
        body = {"evaluation": bando_json(data="12", analysis="33")}
        r = self._patch(self.staff, body)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self._evaluation(), body["evaluation"])


if __name__ == "__main__":
    unittest.main()
