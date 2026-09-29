"""Tên nhóm chat dự án có MÃ dự án đứng trước tên: "Dự án: DA002 Dosco-AI-Agent".

- Nhóm tạo mới: lưu đúng định dạng có mã.
- Nhóm cũ (tạo trước khi có mã) vẫn HIỂN THỊ có mã trong danh sách (tên tính theo dự án
  hiện tại), và được cập nhật tên lưu khi ai đó mở lại chat của dự án.
- Dự án không có mã -> "Dự án: <tên>".

Chạy từ thư mục backend: python -m unittest tests.test_chat_project_title -v
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
from app.models import (
    Company, Conversation, ConversationMember, ConversationType, Project, User, UserRole,
)
from app.routers.chat import router


class ChatProjectTitleTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)

        with self.sessions() as db:
            company = Company(name="Test company", code="TEST-CHAT-TITLE")
            db.add(company)
            db.flush()
            self.director = User(company_id=company.id, email="gd@example.com", full_name="Giam doc",
                                 role=UserRole.DIRECTOR, hashed_password="unused")
            db.add(self.director)
            db.flush()
            p1 = Project(company_id=company.id, code="DA002", name="Dosco-AI-Agent")
            p2 = Project(company_id=company.id, code="0010", name="KDT DA MUC TIEU TAN PHONG")
            p3 = Project(company_id=company.id, code="", name="Du an khong ma")
            db.add_all([p1, p2, p3])
            db.flush()
            self.p1, self.p2, self.p3 = p1.id, p2.id, p3.id
            # Nhóm CŨ của p2: tên chưa có mã (tạo từ bản trước).
            old = Conversation(company_id=company.id, type=ConversationType.GROUP,
                               title="Dự án: KDT DA MUC TIEU TAN PHONG",
                               created_by_id=self.director.id, project_id=p2.id)
            db.add(old)
            db.flush()
            db.add(ConversationMember(company_id=company.id, conversation_id=old.id, user_id=self.director.id))
            self.old_conv = old.id
            db.commit()

        self.app = FastAPI()
        self.app.include_router(router)
        self.app.dependency_overrides[get_db] = self._override_db
        self.app.dependency_overrides[get_current_user] = lambda: self._reload(self.director)
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

    def test_nhom_moi_co_ma_truoc_ten(self):
        r = self.client.get(f"/chat/project/{self.p1}")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["title"], "Dự án: DA002 Dosco-AI-Agent")
        with self.sessions() as db:
            conv = db.query(Conversation).filter(Conversation.project_id == self.p1).one()
            self.assertEqual(conv.title, "Dự án: DA002 Dosco-AI-Agent")

    def test_nhom_cu_hien_co_ma_trong_danh_sach_va_duoc_cap_nhat_khi_mo_lai(self):
        # Danh sách: tên tính theo dự án hiện tại -> có mã dù tên lưu chưa có.
        rows = self.client.get("/chat/conversations").json()
        titles = {row["id"]: row["title"] for row in rows}
        self.assertEqual(titles.get(self.old_conv), "Dự án: 0010 KDT DA MUC TIEU TAN PHONG")
        # Mở lại chat dự án: dùng lại đúng nhóm cũ (không tạo trùng) và tên lưu được cập nhật.
        r = self.client.get(f"/chat/project/{self.p2}")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["id"], self.old_conv)
        with self.sessions() as db:
            self.assertEqual(db.get(Conversation, self.old_conv).title, "Dự án: 0010 KDT DA MUC TIEU TAN PHONG")
            self.assertEqual(db.query(Conversation).filter(Conversation.project_id == self.p2).count(), 1)

    def test_du_an_khong_ma_giu_dinh_dang_cu(self):
        r = self.client.get(f"/chat/project/{self.p3}")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["title"], "Dự án: Du an khong ma")


if __name__ == "__main__":
    unittest.main()
