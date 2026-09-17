"""Quyền ĐỔI TRẠNG THÁI dự án (Đang làm / Hoàn thành / ... hoặc trả về tự động).

Luật (xem update_project ở app/routers/projects.py):
- CHỈ chủ trì dự án đó, Quản trị hệ thống, Giám đốc được đổi.
- Quản lý cấp cao / cấp trung, nhân viên -> 403, dù vẫn sửa được thông tin khác.

Chạy từ thư mục backend: python -m unittest tests.test_project_status_permissions -v
"""
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
from app.models import Company, Project, ProjectStatus, User, UserRole
from app.routers.projects import router

BANDO = "Phòng Bản đồ"


class ProjectStatusPermissionTests(unittest.TestCase):
    """1 dự án có chủ trì; thử từng vai trò ép trạng thái / trả về tự động."""

    def setUp(self):
        self.engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)

        with self.sessions() as db:
            company = Company(name="Test company", code="TEST-STATUS-PERM")
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
            self.staff = mk("nv@example.com", "Nhan vien", UserRole.FIELD_STAFF, BANDO)
            db.add_all([self.admin, self.director, self.senior, self.mid, self.lead, self.staff])
            db.flush()
            self.mid.manager_id = self.senior.id   # cấp trung CÓ sếp -> không phải cấp cao
            project = Project(
                company_id=company.id, code="5139-0257", name="Du an test",
                group_name="測量解析", lead_id=self.lead.id,
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

    def _project(self) -> Project:
        with self.sessions() as db:
            return db.get(Project, self.project_id)

    def test_chu_tri_admin_giam_doc_ep_duoc_va_tra_ve_tu_dong_duoc(self):
        for user in (self.lead, self.admin, self.director):
            r = self._patch(user, {"status": "COMPLETED"})
            self.assertEqual(r.status_code, 200, f"{user.email}: {r.text}")
            p = self._project()
            self.assertEqual(p.status, ProjectStatus.COMPLETED)
            self.assertTrue(p.status_locked)   # tự chọn = ÉP -> khoá, không tính đè

            r = self._patch(user, {"status_locked": False})
            self.assertEqual(r.status_code, 200, f"{user.email}: {r.text}")
            self.assertFalse(self._project().status_locked)

    def test_quan_ly_va_nhan_vien_khong_duoc_doi(self):
        for user in (self.senior, self.mid, self.staff):
            for body in ({"status": "COMPLETED"}, {"status_locked": False}):
                r = self._patch(user, body)
                self.assertEqual(r.status_code, 403, f"{user.email} {body}: {r.text}")
        p = self._project()
        self.assertEqual(p.status, ProjectStatus.PLANNING)
        self.assertFalse(p.status_locked)

    def test_quan_ly_van_sua_duoc_thong_tin_khac(self):
        for user in (self.senior, self.mid):
            r = self._patch(user, {"location": f"Kho {user.email}"})
            self.assertEqual(r.status_code, 200, f"{user.email}: {r.text}")
        self.assertEqual(self._project().location, "Kho qlct@example.com")


if __name__ == "__main__":
    unittest.main()
