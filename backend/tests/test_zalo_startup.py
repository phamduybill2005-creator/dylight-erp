"""Exercise real application startup only in a separate, disposable environment."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class ZaloStartupTests(unittest.TestCase):
    def test_erp_starts_without_zalo_configuration_or_implicit_migration(self):
        backend = Path(__file__).resolve().parents[1]
        env = os.environ.copy()
        env.update(PYTHONPATH=str(backend), DATABASE_URL="sqlite:///:memory:", DEBUG="true",
                   AUTO_SEED="false", YUNATT_ENABLED="false", ZALO_ENABLED="false",
                   ZALO_APP_ID="", ZALO_APP_SECRET="", ZALO_TOKEN_ENCRYPTION_KEY="", UPLOAD_DIR="uploads")
        code = """
from sqlalchemy import inspect
from fastapi.testclient import TestClient
from app.main import app, engine
tables = set(inspect(engine).get_table_names())
assert 'users' in tables and 'projects' in tables
assert not {'zalo_oauth_transactions', 'zalo_oa_credentials'}.intersection(tables)
assert 'zalo_evaluation_reminders' not in tables
paths = {route.path for route in app.routes}
assert '/api/zalo/callback' in paths and '/api/zalo/authorize' in paths
assert '/api/v1/auth/login' in paths
assert '/api/v1/zalo/callback' not in paths
with TestClient(app) as client:
    response = client.get('/api/zalo/callback?code=synthetic-code&state=synthetic-state')
    assert response.status_code == 503
    assert response.headers['cache-control'] == 'no-store'
    assert response.headers['referrer-policy'] == 'no-referrer'
    assert 'synthetic-code' not in response.text
print('Isolated startup verified.')
"""
        # Working outside backend prevents loading backend/.env.
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run([sys.executable, "-c", code], env=env, cwd=directory,
                                    capture_output=True, text=True, encoding="utf-8", timeout=45)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Isolated startup verified.", result.stdout)


if __name__ == "__main__":
    unittest.main()
