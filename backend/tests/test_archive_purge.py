"""Xóa vĩnh viễn trong Thùng rác — /archive/purge-item, /archive/purge-project.

Luật (xem app/routers/archive.py):
- Chỉ Quản trị hệ thống / Giám đốc / Quản lý cấp cao xóa vĩnh viễn được.
- Xóa hạng mục: cuốn theo đầu việc con, giờ công, đánh giá của hạng mục đó.
- Xóa dự án: TỪ CHỐI nếu còn hợp đồng / hóa đơn / nhật ký... để không mất sổ sách.
- Đánh giá nhân sự không bị xóa theo, chỉ gỡ liên kết tới dự án.

Chạy từ thư mục backend: python -m unittest tests.test_archive_purge -v
"""
import os
import unittest
from datetime import date

os.environ["DATABASE_URL"] = "sqlite+pysqlite:///:memory:"
os.environ["DEBUG"] = "true"

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.deps import get_current_user
from app.models import (
    Company, Contract, Evaluation, EvaluationDirection, Project, ProjectItem,
    Timesheet, User, UserRole,
)
from app.routers.archive import router


class ArchivePurgeTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        self.today = date.today()

        with self.sessions() as db:
            company = Company(name="Test company", code="TEST-PURGE")
            db.add(company)
            db.flush()
            self.company_id = company.id

            def mk(email, name, role):
                return User(company_id=company.id, email=email, full_name=name,
                            role=role, hashed_password="unused")

            self.admin = mk("admin@example.com", "Quan tri", UserRole.ADMIN)
            self.director = mk("gd@example.com", "Giam doc", UserRole.DIRECTOR)
            self.senior = mk("qlcc@example.com", "QL cap cao", UserRole.MANAGER)
            self.mid = mk("qlct@example.com", "QL cap trung", UserRole.MANAGER_MID)
            self.staff = mk("nv@example.com", "Nhan vien", UserRole.FIELD_STAFF)
            db.add_all([self.admin, self.director, self.senior, self.mid, self.staff])
            db.flush()

            # clean = dự án rỗng, có thể xóa hẳn. dirty = còn hợp đồng -> phải chặn.
            clean = Project(company_id=company.id, code="P-CLEAN", name="Du an sach",
                            is_deleted=True, lead_id=self.director.id)
            dirty = Project(company_id=company.id, code="P-DIRTY", name="Du an co hop dong",
                            is_deleted=True, lead_id=self.director.id)
            db.add_all([clean, dirty])
            db.flush()
            self.clean_id, self.dirty_id = clean.id, dirty.id
            for p in (clean, dirty):
                p.members.append(db.get(User, self.staff.id))

            db.add(Contract(company_id=company.id, project_id=dirty.id,
                            code="HD-01", name="Hop dong thi cong"))

            # Nhóm cha đã xóa + 1 đầu việc con + giờ công của con.
            group = ProjectItem(company_id=company.id, project_id=clean.id,
                                name="Nhom cha", is_deleted=True)
            db.add(group)
            db.flush()
            child = ProjectItem(company_id=company.id, project_id=clean.id,
                                parent_id=group.id, name="Dau viec con", is_deleted=True)
            alive = ProjectItem(company_id=company.id, project_id=clean.id,
                                name="Hang muc con song")
            db.add_all([child, alive])
            db.flush()
            self.group_id, self.child_id, self.alive_id = group.id, child.id, alive.id

            db.add_all([
                Timesheet(company_id=company.id, user_id=self.staff.id,
                          project_id=clean.id, project_item_id=child.id,
                          work_date=self.today, hours=6),
                Timesheet(company_id=company.id, user_id=self.staff.id,
                          project_id=clean.id, project_item_id=alive.id,
                          work_date=self.today, hours=2),
            ])
            # Đánh giá nhân sự gắn dự án — hồ sơ con người, không được xóa theo.
            db.add(Evaluation(company_id=company.id, evaluator_id=self.director.id,
                              evaluatee_id=self.staff.id, project_id=clean.id,
                              direction=EvaluationDirection.MANAGER_TO_STAFF,
                              period="2026-09-19", rating=5))
            db.commit()

        self.app = FastAPI()
        self.app.include_router(router)
        self.app.dependency_overrides[get_db] = self._override_db
        self.current = self.admin
        self.app.dependency_overrides[get_current_user] = lambda: self._reload(self.current)
        self.client = TestClient(self.app)

    def tearDown(self):
        self.client.close()
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def _override_db(self):
        db = self.sessions()
        try:
            yield db
        finally:
            db.close()

    def _reload(self, user):
        with self.sessions() as db:
            return db.get(User, user.id)

    def _count(self, model, **filters):
        with self.sessions() as db:
            q = db.query(model)
            for k, v in filters.items():
                q = q.filter(getattr(model, k) == v)
            return q.count()

    # --------- Quyền ---------

    def test_top_leadership_can_purge(self):
        for boss in (self.admin, self.director, self.senior):
            with self.subTest(role=boss.role.value):
                with self.sessions() as db:   # dựng lại hạng mục cho mỗi vòng
                    it = ProjectItem(company_id=self.company_id, project_id=self.clean_id,
                                     name="Tam", is_deleted=True)
                    db.add(it)
                    db.commit()
                    tmp_id = it.id
                self.current = boss
                resp = self.client.delete(f"/archive/purge-item/{tmp_id}")
                self.assertEqual(resp.status_code, 200, resp.text)

    def test_mid_manager_and_staff_cannot_purge(self):
        for u in (self.mid, self.staff):
            with self.subTest(role=u.role.value):
                self.current = u
                resp = self.client.delete(f"/archive/purge-item/{self.group_id}")
                self.assertEqual(resp.status_code, 403)
                self.assertIn("xóa vĩnh viễn", resp.json()["detail"])
        self.assertEqual(self._count(ProjectItem, id=self.group_id), 1)

    def test_cannot_purge_item_that_is_not_in_trash(self):
        self.current = self.admin
        resp = self.client.delete(f"/archive/purge-item/{self.alive_id}")
        self.assertEqual(resp.status_code, 404)

    # --------- Xóa hạng mục ---------

    def test_purging_group_removes_children_and_their_hours(self):
        self.current = self.admin
        resp = self.client.delete(f"/archive/purge-item/{self.group_id}")
        self.assertEqual(resp.status_code, 200, resp.text)
        self.assertEqual(resp.json()["deleted_items"], 2)   # cha + con

        self.assertEqual(self._count(ProjectItem, id=self.group_id), 0)
        self.assertEqual(self._count(ProjectItem, id=self.child_id), 0)
        self.assertEqual(self._count(Timesheet, project_item_id=self.child_id), 0)
        # Hạng mục còn sống và giờ của nó KHÔNG bị đụng tới.
        self.assertEqual(self._count(ProjectItem, id=self.alive_id), 1)
        self.assertEqual(self._count(Timesheet, project_item_id=self.alive_id), 1)

    # --------- Xóa dự án ---------

    def test_purge_project_blocked_when_it_still_has_records(self):
        self.current = self.admin
        resp = self.client.delete(f"/archive/purge-project/{self.dirty_id}")
        self.assertEqual(resp.status_code, 409)
        detail = resp.json()["detail"]
        self.assertIn("1 hợp đồng", detail)
        self.assertEqual(self._count(Project, id=self.dirty_id), 1)   # còn nguyên
        self.assertEqual(self._count(Contract, project_id=self.dirty_id), 1)

    def test_purge_clean_project_removes_items_and_hours(self):
        self.current = self.director
        resp = self.client.delete(f"/archive/purge-project/{self.clean_id}")
        self.assertEqual(resp.status_code, 200, resp.text)

        self.assertEqual(self._count(Project, id=self.clean_id), 0)
        self.assertEqual(self._count(ProjectItem, project_id=self.clean_id), 0)
        self.assertEqual(self._count(Timesheet, project_id=self.clean_id), 0)

    def test_purge_project_keeps_staff_evaluations(self):
        """Đánh giá nhân sự là hồ sơ con người — chỉ gỡ liên kết dự án."""
        self.current = self.director
        self.assertEqual(
            self.client.delete(f"/archive/purge-project/{self.clean_id}").status_code, 200
        )
        with self.sessions() as db:
            evals = db.query(Evaluation).all()
            self.assertEqual(len(evals), 1)
            self.assertIsNone(evals[0].project_id)

    def test_cannot_purge_project_that_is_not_in_trash(self):
        with self.sessions() as db:
            p = db.get(Project, self.clean_id)
            p.is_deleted = False
            db.commit()
        self.current = self.admin
        resp = self.client.delete(f"/archive/purge-project/{self.clean_id}")
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(self._count(Project, id=self.clean_id), 1)


if __name__ == "__main__":
    unittest.main()
