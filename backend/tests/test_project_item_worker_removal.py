"""Gỡ người khỏi đầu việc — DELETE /project-items/{item_id}/workers/{user_id}.

Luật (xem remove_item_worker trong app/routers/project_items.py):
- Chỉ chủ trì/quản lý dự án, hoặc chính người phụ trách đầu việc, mới gỡ được.
- Không gỡ được người đang là Phụ trách chính (phải đổi Phụ trách chính trước).
- Gỡ xong thì giờ họ khai TRÊN ĐẦU VIỆC ĐÓ bị xóa theo; giờ ở đầu việc khác giữ nguyên.

Chạy từ thư mục backend: python -m unittest tests.test_project_item_worker_removal -v
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
from app.models import Company, Project, ProjectItem, Timesheet, User, UserRole
from app.routers.project_items import router


class RemoveItemWorkerTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        self.work_date = date.today()

        with self.sessions() as db:
            company = Company(name="Test company", code="TEST-RM-WORKER")
            db.add(company)
            db.flush()
            self.company_id = company.id

            def mk(email, name, role):
                return User(company_id=company.id, email=email, full_name=name,
                            role=role, hashed_password="unused")

            self.admin = mk("admin@example.com", "Quan tri", UserRole.ADMIN)
            self.lead = mk("lead@example.com", "Chu tri", UserRole.FIELD_STAFF)
            self.owner = mk("owner@example.com", "Phu trach dau viec", UserRole.FIELD_STAFF)
            self.helper = mk("helper@example.com", "Nguoi cung lam", UserRole.FIELD_STAFF)
            self.outsider = mk("out@example.com", "Nhan vien khac", UserRole.FIELD_STAFF)
            project = Project(company_id=company.id, code="P-01", name="Du an test")
            db.add_all([self.admin, self.lead, self.owner, self.helper,
                        self.outsider, project])
            db.flush()
            project.lead_id = self.lead.id
            for u in (self.admin, self.lead, self.owner, self.helper, self.outsider):
                project.members.append(u)
            self.project_id = project.id

            item = ProjectItem(company_id=company.id, project_id=project.id,
                               name="Dau viec chinh", assignee_id=self.owner.id)
            other = ProjectItem(company_id=company.id, project_id=project.id,
                                name="Dau viec khac")
            db.add_all([item, other])
            db.flush()
            item.workers.append(db.get(User, self.helper.id))
            self.item_id, self.other_item_id = item.id, other.id

            # Giờ của "người cùng làm" trên CẢ HAI đầu việc, để kiểm tra chỉ giờ
            # ở đầu việc bị gỡ mới mất.
            db.add_all([
                Timesheet(company_id=company.id, user_id=self.helper.id,
                          project_id=project.id, project_item_id=item.id,
                          work_date=self.work_date, hours=8),
                Timesheet(company_id=company.id, user_id=self.helper.id,
                          project_id=project.id, project_item_id=other.id,
                          work_date=self.work_date, hours=5),
            ])
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

    def _remove(self, uid, item_id=None):
        return self.client.delete(
            f"/project-items/{item_id or self.item_id}/workers/{uid}"
        )

    def _worker_ids(self, item_id=None):
        resp = self.client.get("/project-items", params={"project_id": self.project_id})
        row = next(r for r in resp.json() if r["id"] == (item_id or self.item_id))
        return row["worker_ids"]

    def _hours_rows(self, item_id):
        with self.sessions() as db:
            return db.query(Timesheet).filter(
                Timesheet.project_item_id == item_id,
                Timesheet.user_id == self.helper.id,
            ).count()

    # --------- Ai gỡ được ---------

    def test_admin_can_remove_worker(self):
        self.current = self.admin
        self.assertEqual(self._remove(self.helper.id).status_code, 200)
        self.assertEqual(self._worker_ids(), [])

    def test_project_lead_can_remove_worker_without_hours(self):
        """Chủ trì ở đây là nhân viên -> gỡ được người chưa khai giờ, nhưng KHÔNG
        xóa được giờ đồng nghiệp (xem test bên dưới)."""
        with self.sessions() as db:
            db.query(Timesheet).filter(
                Timesheet.project_item_id == self.item_id,
                Timesheet.user_id == self.helper.id,
            ).delete(synchronize_session=False)
            db.commit()
        self.current = self.lead
        self.assertEqual(self._remove(self.helper.id).status_code, 200)

    def test_staff_project_lead_cannot_remove_worker_who_logged_hours(self):
        self.current = self.lead
        resp = self._remove(self.helper.id)
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(self._hours_rows(self.item_id), 1)

    def test_item_assignee_can_remove_worker_without_hours(self):
        """Người phụ trách đầu việc tự dọn được người THÊM NHẦM (chưa khai giờ)."""
        with self.sessions() as db:   # bỏ hết giờ của helper trên đầu việc này
            db.query(Timesheet).filter(
                Timesheet.project_item_id == self.item_id,
                Timesheet.user_id == self.helper.id,
            ).delete(synchronize_session=False)
            db.commit()
        self.current = self.owner
        self.assertEqual(self._remove(self.helper.id).status_code, 200)
        self.assertEqual(self._worker_ids(), [])

    def test_item_assignee_cannot_remove_worker_who_logged_hours(self):
        """Cửa sau của luật giờ: phụ trách đầu việc không sửa được giờ đồng
        nghiệp thì cũng không được xóa sạch bằng cách gỡ họ ra."""
        self.current = self.owner
        resp = self._remove(self.helper.id)
        self.assertEqual(resp.status_code, 403)
        self.assertIn("đã khai giờ", resp.json()["detail"])
        self.assertEqual(self._worker_ids(), [self.helper.id])
        self.assertEqual(self._hours_rows(self.item_id), 1)   # giờ còn nguyên

    def test_senior_role_can_remove_worker_who_logged_hours(self):
        self.current = self.admin
        self.assertEqual(self._remove(self.helper.id).status_code, 200)
        self.assertEqual(self._hours_rows(self.item_id), 0)

    def test_worker_can_remove_themselves_even_with_hours(self):
        """Giờ của chính mình thì mình xóa được -> tự rút khỏi đầu việc cũng được.
        (helper được quyền gỡ vì là cấp dưới? không — ở đây helper là chủ trì thì
        mới qua được cổng đầu, nên test bằng chủ trì tự gỡ chính mình.)"""
        with self.sessions() as db:
            item = db.get(ProjectItem, self.item_id)
            item.workers.append(db.get(User, self.lead.id))
            db.add(Timesheet(company_id=self.company_id, user_id=self.lead.id,
                             project_id=self.project_id, project_item_id=self.item_id,
                             work_date=self.work_date, hours=3))
            db.commit()
        self.current = self.lead
        self.assertEqual(self._remove(self.lead.id).status_code, 200)
        self.assertNotIn(self.lead.id, self._worker_ids())

    def test_unrelated_staff_cannot_remove_worker(self):
        self.current = self.outsider
        resp = self._remove(self.helper.id)
        self.assertEqual(resp.status_code, 403)
        self.assertIn("mới gỡ", resp.json()["detail"])
        self.assertEqual(self._worker_ids(), [self.helper.id])

    # --------- Phụ trách chính ---------

    def test_cannot_remove_main_assignee(self):
        self.current = self.admin
        resp = self._remove(self.owner.id)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Phụ trách chính", resp.json()["detail"])

    # --------- Giờ đi theo đúng phạm vi ---------

    def test_removing_worker_deletes_their_hours_on_that_item_only(self):
        self.assertEqual(self._hours_rows(self.item_id), 1)
        self.assertEqual(self._hours_rows(self.other_item_id), 1)

        self.current = self.admin
        self.assertEqual(self._remove(self.helper.id).status_code, 200)

        self.assertEqual(self._hours_rows(self.item_id), 0)      # đầu việc bị gỡ
        self.assertEqual(self._hours_rows(self.other_item_id), 1)  # đầu việc khác còn nguyên

    def test_remove_is_idempotent(self):
        """Gỡ người không nằm trong danh sách -> vẫn 200, không nổ lỗi."""
        self.current = self.admin
        self.assertEqual(self._remove(self.helper.id).status_code, 200)
        self.assertEqual(self._remove(self.helper.id).status_code, 200)
        self.assertEqual(self._worker_ids(), [])


if __name__ == "__main__":
    unittest.main()
