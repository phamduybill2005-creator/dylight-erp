"""Isolated OAuth tests: fake HTTP transport, synthetic tokens, no live .env."""
import base64
import hashlib
import importlib
import logging
import os
import unittest
from unittest.mock import patch
from datetime import datetime, timedelta
from urllib.parse import parse_qs, urlsplit

os.environ['DATABASE_URL'] = 'sqlite+pysqlite:///:memory:'
os.environ['DEBUG'] = 'true'
os.environ['AUTO_SEED'] = 'false'
os.environ['YUNATT_ENABLED'] = 'false'
os.environ['ZALO_ENABLED'] = 'false'

import httpx
from cryptography.fernet import Fernet
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from sqlalchemy.exc import SQLAlchemyError

from app.config import Settings
from app.database import Base, get_db
from app.models import Company, User, UserRole
from app.security import create_access_token

ACCESS, REFRESH = 'synthetic-access-one', 'synthetic-refresh-one'


class ZaloOAuthTests(unittest.TestCase):
    def setUp(self):
        try:
            self.routes = importlib.import_module('app.routers.zalo')
            self.oauth = importlib.import_module('app.services.zalo_oauth_service')
            self.oa = importlib.import_module('app.services.zalo_oa_service')
            models = importlib.import_module('app.zalo_models')
        except ModuleNotFoundError:
            self.fail('Zalo OAuth is not implemented yet')
        self.Transaction, self.Credential = models.ZaloOAuthTransaction, models.ZaloOACredential
        self.engine = create_engine('sqlite+pysqlite:///:memory:', poolclass=StaticPool,
                                    connect_args={'check_same_thread': False})
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        self.db = self.sessions()
        company, other = Company(name='Test DOSCO', code='ZALO'), Company(name='Other', code='OTHER')
        self.db.add_all([company, other])
        self.db.flush()
        self.admin = User(company_id=company.id, role=UserRole.ADMIN, email='admin@example.com',
                          full_name='Test admin', hashed_password='unused', token_version=0)
        self.other = User(company_id=other.id, role=UserRole.ADMIN, email='other@example.com',
                          full_name='Other admin', hashed_password='unused', token_version=0)
        self.db.add_all([self.admin, self.other])
        self.db.commit()
        self.key = Fernet.generate_key().decode()
        self.config = Settings(_env_file=None, ZALO_ENABLED=True, ZALO_APP_ID='123456',
                               ZALO_APP_SECRET='synthetic-app-secret', ZALO_OA_ID='987654',
                               ZALO_COMPANY_ID=company.id, ZALO_TOKEN_ENCRYPTION_KEY=self.key)
        self.requests = []
        self.handler = self.respond
        self.http = httpx.Client(transport=httpx.MockTransport(self.dispatch))
        self.service = self.oauth.ZaloOAuthService(self.db, self.config, self.http)
        app = FastAPI()
        app.include_router(self.routes.router)
        app.dependency_overrides[get_db] = lambda: self.db
        app.dependency_overrides[self.routes.get_zalo_service] = lambda: self.service
        self.client = TestClient(app, base_url='https://erp.dosco.vn')
        self.login(self.admin)

    def tearDown(self):
        if hasattr(self, 'client'):
            self.client.close()
            self.http.close()
            self.db.close()
            self.engine.dispose()

    def login(self, user):
        token = create_access_token(str(user.id), {'tv': user.token_version or 0})
        self.client.headers['Authorization'] = 'Bearer ' + token

    def dispatch(self, request):
        self.requests.append(request)
        # This App has only GMF permissions. A profile request would be denied.
        if request.url.path == '/v2.0/oa/getoa':
            return httpx.Response(403, json={'error': -1, 'message': 'Profile permission unavailable'})
        return self.handler(request)

    def respond(self, request):
        if request.url.path == '/v4/oa/access_token':
            data = parse_qs(request.content.decode())
            self.assertEqual(request.method, 'POST')
            self.assertEqual(request.headers['secret_key'], 'synthetic-app-secret')
            self.assertIn('application/x-www-form-urlencoded', request.headers['content-type'])
            self.assertEqual(data['app_id'], ['123456'])
            if data['grant_type'] == ['authorization_code']:
                self.assertEqual(data['code'], ['synthetic-code'])
                self.assertEqual(len(data['code_verifier'][0]), 43)
                return httpx.Response(200, json={'access_token': ACCESS, 'refresh_token': REFRESH,
                                                 'expires_in': '90000'})
            self.assertEqual(data['grant_type'], ['refresh_token'])
            self.assertEqual(data['refresh_token'], [REFRESH])
            self.assertNotIn('code_verifier', data)
            return httpx.Response(200, json={'access_token': 'synthetic-access-two',
                                             'refresh_token': 'synthetic-refresh-two', 'expires_in': '90000'})
        self.assertEqual(request.headers['access_token'], ACCESS)
        if request.url.path == '/v3.0/oa/group/getgroupsofoa':
            return httpx.Response(200, json={'error': 0, 'data': {'offset': 0, 'count': 5, 'total': 1,
                'groups': [{'group_id': 'gmf-test', 'name': 'Test group', 'status': 'enabled',
                            'total_member': 3, 'group_link': 'private-link', 'access_token': ACCESS}]}})
        self.assertEqual(request.url.path, '/v3.0/oa/group/message')
        import json
        self.assertEqual(json.loads(request.content), {'recipient': {'group_id': 'gmf-test'},
                                                       'message': {'text': 'Test text'}})
        return httpx.Response(200, json={'error': 0, 'data': {'group_id': 'gmf-test', 'message_id': 'msg-test'}})

    def begin(self):
        response = self.client.post('/api/zalo/authorize')
        self.assertEqual(response.status_code, 200, response.text)
        query = parse_qs(urlsplit(response.json()['authorization_url']).query)
        return response, query

    def callback(self, query, **extra):
        return self.client.get('/api/zalo/callback', params={
            'code': 'synthetic-code', 'oa_id': '987654', 'state': query['state'][0], **extra})

    def connect(self):
        _, query = self.begin()
        response = self.callback(query)
        self.assertEqual(response.status_code, 200, response.text)
        return self.db.scalar(select(self.Credential))

    def test_random_pkce_and_state_with_secure_browser_cookie(self):
        response, query = self.begin()
        row = self.db.scalar(select(self.Transaction))
        self.assertEqual(row.state_hash, hashlib.sha256(query['state'][0].encode()).hexdigest())
        verifier = Fernet(self.key).decrypt(row.code_verifier_encrypted.encode()).decode()
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode('ascii')).digest()).decode().rstrip('=')
        self.assertEqual(query['code_challenge'], [challenge])
        self.assertEqual(query['redirect_uri'], ['https://erp.dosco.vn/api/zalo/callback'])
        self.assertNotIn('code_challenge_method', query)
        self.assertNotIn(verifier, response.text)
        self.assertIn('HttpOnly', response.headers['set-cookie'])
        self.assertIn('Secure', response.headers['set-cookie'])
        self.assertIn('SameSite=lax', response.headers['set-cookie'])
        _, second = self.begin()
        self.assertNotEqual(query['state'], second['state'])
        self.assertNotEqual(query['code_challenge'], second['code_challenge'])

    def test_callback_without_jwt_stores_encrypted_pair_once(self):
        _, query = self.begin()
        pending = self.db.scalar(select(self.Transaction))
        verifier = Fernet(self.key).decrypt(pending.code_verifier_encrypted.encode()).decode()
        del self.client.headers['Authorization']
        response = self.callback(query)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {'status': 'connected', 'oa_id': '987654'})
        row = self.db.scalar(select(self.Credential))
        cipher = Fernet(self.key)
        self.assertEqual(cipher.decrypt(row.access_token_encrypted.encode()).decode(), ACCESS)
        self.assertEqual(cipher.decrypt(row.refresh_token_encrypted.encode()).decode(), REFRESH)
        self.assertEqual((row.oa_id, row.company_id, row.app_id),
                         ('987654', self.admin.company_id, '123456'))
        self.assertEqual(parse_qs(self.requests[0].content.decode())['code_verifier'], [verifier])
        self.assertNotIn(ACCESS, row.access_token_encrypted)
        transaction = self.db.scalar(select(self.Transaction))
        self.assertIsNone(transaction.code_verifier_encrypted)
        self.assertIsNotNone(transaction.consumed_at)
        self.assertEqual(self.callback(query).status_code, 400)
        self.assertEqual(len(self.requests), 1)

    def test_state_expiry_browser_and_oa_rejections_never_exchange(self):
        for kind in ('state', 'expiry', 'browser', 'oa'):
            with self.subTest(kind=kind):
                _, query = self.begin()
                extra = {}
                if kind == 'state': extra['state'] = 'wrong'
                if kind == 'oa': extra['oa_id'] = 'wrong'
                if kind == 'expiry':
                    row = self.db.scalar(select(self.Transaction).where(self.Transaction.state_hash ==
                                         hashlib.sha256(query['state'][0].encode()).hexdigest()))
                    row.expires_at = datetime(2000, 1, 1)
                    self.db.commit()
                if kind == 'browser': self.client.cookies.clear()
                self.assertEqual(self.callback(query, **extra).status_code, 400)
        self.assertEqual(self.client.get('/api/zalo/callback').status_code, 400)
        self.assertEqual(self.requests, [])

    def test_latest_attempt_invalidates_older_link(self):
        _, first = self.begin()
        _, second = self.begin()
        self.assertEqual(self.callback(first).status_code, 400)
        # Failed old attempt must not clear the current browser cookie.
        self.assertEqual(self.callback(second).status_code, 200)

    def test_revoked_admin_cannot_complete(self):
        _, query = self.begin()
        self.admin.token_version = 1
        self.db.commit()
        self.assertEqual(self.callback(query).status_code, 403)
        self.assertEqual(self.requests, [])

    def test_admin_tenant_and_jwt_are_required_for_start_and_groups(self):
        del self.client.headers['Authorization']
        self.assertEqual(self.client.post('/api/zalo/authorize').status_code, 401)
        self.assertEqual(self.client.get('/api/zalo/groups').status_code, 401)
        self.login(self.other)
        self.assertEqual(self.client.post('/api/zalo/authorize').status_code, 403)
        self.assertEqual(self.client.get('/api/zalo/groups').status_code, 403)
        self.admin.role = UserRole.DIRECTOR
        self.db.commit()
        self.login(self.admin)
        self.assertEqual(self.client.post('/api/zalo/authorize').status_code, 403)

    def test_config_is_disabled_or_incomplete_without_secret_response(self):
        for field, value in [('ZALO_ENABLED', False), ('ZALO_COMPANY_ID', 0),
                              ('ZALO_TOKEN_ENCRYPTION_KEY', 'invalid'), ('ZALO_APP_SECRET', '')]:
            with self.subTest(field=field):
                self.service.config = Settings(_env_file=None, **{**self.config.model_dump(), field: value})
                response = self.client.post('/api/zalo/authorize')
                self.assertEqual(response.status_code, 503)
                self.assertNotIn('synthetic-app-secret', response.text)
        self.assertEqual(self.requests, [])

    def test_same_host_and_origin_required_for_browser_binding(self):
        for headers in ({'host': 'backend.invalid'}, {'origin': 'https://evil.invalid'}):
            response = self.client.post('/api/zalo/authorize', headers=headers)
            self.assertEqual(response.status_code, 400)
            self.assertNotIn('set-cookie', response.headers)

    def test_callback_errors_never_cache_or_reflect_provider_input(self):
        _, query = self.begin()
        self.handler = lambda r: httpx.Response(200, json={'error': -14002, 'message': REFRESH})
        response = self.callback(query)
        self.assertEqual(response.status_code, 502)
        self.assertNotIn(REFRESH, response.text)
        self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertEqual(response.headers['referrer-policy'], 'no-referrer')
        self.assertEqual(self.callback(query).status_code, 400)
        self.assertIsNone(self.db.scalar(select(self.Credential)))

    def test_invalid_provider_token_payload_is_not_saved(self):
        for expiry in (-1, None, True, 'invalid'):
            _, query = self.begin()
            self.handler = lambda r: httpx.Response(200, json={'access_token': ACCESS, 'refresh_token': REFRESH,
                                                             'expires_in': expiry})
            self.assertEqual(self.callback(query).status_code, 502)
        self.assertIsNone(self.db.scalar(select(self.Credential)))

    def test_groups_filter_secrets_and_preserve_pagination(self):
        self.connect()
        response = self.client.get('/api/zalo/groups?offset=0&count=5')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['groups'], [{'group_id': 'gmf-test', 'name': 'Test group',
                                                     'status': 'enabled', 'total_member': 3}])
        self.assertNotIn(ACCESS, response.text)
        self.assertNotIn('private-link', response.text)
        self.assertEqual(self.requests[-1].url.params['count'], '5')
        self.assertEqual(self.client.get('/api/zalo/groups?offset=-1').status_code, 422)

    def test_refresh_rotates_pair_and_does_not_refresh_twice(self):
        row = self.connect()
        row.expires_at = datetime(2000, 1, 1)
        self.db.commit()
        self.assertEqual(self.service.get_valid_access_token(self.admin.company_id), 'synthetic-access-two')
        self.assertEqual(self.service.get_valid_access_token(self.admin.company_id), 'synthetic-access-two')
        self.assertEqual(len(self.requests), 2)
        self.db.refresh(row)
        self.assertEqual(Fernet(self.key).decrypt(row.refresh_token_encrypted.encode()).decode(), 'synthetic-refresh-two')
        self.assertEqual(row.status, 'active')

    def test_uncertain_refresh_never_reuses_single_use_token(self):
        row = self.connect()
        row.expires_at = datetime(2000, 1, 1)
        self.db.commit()
        def timeout(request): raise httpx.ReadTimeout(REFRESH, request=request)
        self.handler = timeout
        for _ in range(2):
            with self.assertRaises(self.oauth.ZaloError) as error:
                self.service.get_valid_access_token(self.admin.company_id)
            self.assertNotIn(REFRESH, str(error.exception))
        self.assertEqual(len(self.requests), 2)
        self.db.refresh(row)
        self.assertEqual(row.status, 'reconnect_required')

    def test_refresh_claim_and_generation_prevent_duplicate_or_late_write(self):
        row = self.connect()
        repo = self.service.repository()
        generation = row.generation
        self.assertTrue(repo.claim_refresh(row.id, generation))
        self.assertFalse(repo.claim_refresh(row.id, generation))
        _, query = self.begin()
        self.assertEqual(self.callback(query).status_code, 200)
        self.assertFalse(repo.finish_refresh(row.id, generation, 'stale-access', 'stale-refresh', datetime(2030, 1, 1)))
        self.db.refresh(row)
        self.assertEqual(Fernet(self.key).decrypt(row.access_token_encrypted.encode()).decode(), ACCESS)

    def test_database_failure_after_refresh_rotation_blocks_reuse_and_hides_token(self):
        row = self.connect()
        row.expires_at = datetime(2000, 1, 1)
        self.db.commit()
        with patch('app.services.zalo_repository.ZaloRepository.finish_refresh', side_effect=SQLAlchemyError(REFRESH)):
            response = self.client.get('/api/zalo/groups')
        self.assertEqual(response.status_code, 409)
        self.assertNotIn(REFRESH, response.text)
        self.db.refresh(row)
        self.assertEqual(row.status, 'reconnect_required')
        self.assertEqual(self.client.get('/api/zalo/groups').status_code, 409)
        self.assertEqual(len(self.requests), 2)

    def test_durable_refresh_claim_after_crash_blocks_reuse(self):
        row = self.connect()
        self.assertTrue(self.service.repository().claim_refresh(row.id, row.generation))
        self.assertEqual(self.client.get('/api/zalo/groups').status_code, 409)
        self.assertEqual(len(self.requests), 1)

    def test_callback_and_refresh_work_without_profile_api_permission(self):
        row = self.connect()
        original_binding = (row.oa_id, row.company_id, row.app_id)
        row.expires_at = datetime(2000, 1, 1)
        self.db.commit()
        self.assertEqual(self.service.get_valid_access_token(self.admin.company_id), 'synthetic-access-two')
        self.db.refresh(row)
        self.assertEqual((row.oa_id, row.company_id, row.app_id), original_binding)
        self.assertEqual(original_binding, ('987654', self.admin.company_id, '123456'))
        self.assertEqual([request.url.path for request in self.requests],
                         ['/v4/oa/access_token', '/v4/oa/access_token'])

    def test_callback_oa_mismatch_or_missing_does_not_consume_or_exchange(self):
        _, query = self.begin()
        for oa_id in ('', '999999'):
            with self.subTest(oa_id=oa_id):
                response = self.callback(query, oa_id=oa_id)
                self.assertEqual(response.status_code, 400)
                transaction = self.db.scalar(select(self.Transaction))
                self.assertEqual(transaction.status, 'pending')
                self.assertIsNone(transaction.consumed_at)
                self.assertIsNotNone(transaction.code_verifier_encrypted)
        self.assertEqual(self.requests, [])
        self.assertIsNone(self.db.scalar(select(self.Credential)))
        self.assertEqual(self.callback(query).status_code, 200)

    def test_transaction_oa_company_and_admin_must_match(self):
        for field, value, expected in (('oa_id', '999999', 400),
                                        ('company_id', self.other.company_id, 400),
                                        ('admin_id', self.other.id, 403)):
            with self.subTest(field=field):
                _, query = self.begin()
                transaction = self.db.scalar(select(self.Transaction).where(
                    self.Transaction.state_hash == hashlib.sha256(query['state'][0].encode()).hexdigest()))
                setattr(transaction, field, value)
                self.db.commit()
                self.assertEqual(self.callback(query).status_code, expected)
        self.assertEqual(self.requests, [])

    def test_refresh_rejects_credential_bound_to_other_oa_without_requests(self):
        row = self.connect()
        row.oa_id = '999999'
        row.expires_at = datetime(2000, 1, 1)
        self.db.commit()
        response = self.client.get('/api/zalo/groups')
        self.assertEqual(response.status_code, 409)
        self.db.refresh(row)
        self.assertEqual(row.status, 'active')
        self.assertEqual(Fernet(self.key).decrypt(row.access_token_encrypted.encode()).decode(), ACCESS)
        self.assertEqual(len(self.requests), 1)  # Only the original code exchange.

    def test_missing_zalo_migration_does_not_expose_database_error(self):
        self.Transaction.__table__.drop(self.engine)
        response = self.client.post('/api/zalo/authorize')
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('state_hash', response.text)
        self.assertNotIn('INSERT', response.text)
        self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertEqual(self.requests, [])

    def test_late_callback_cannot_overwrite_newer_attempt(self):
        _, query = self.begin()
        def supersede(request):
            self.service.begin(self.admin)
            return self.respond(request)
        self.handler = supersede
        self.assertEqual(self.callback(query).status_code, 409)
        self.assertIsNone(self.db.scalar(select(self.Credential)))

    def test_gmf_send_is_service_only_and_uses_verified_payload(self):
        self.connect()
        self.assertEqual(self.oa.ZaloOAService(self.service).send_gmf_message('gmf-test', 'Test text'),
                         {'group_id': 'gmf-test', 'message_id': 'msg-test'})
        self.assertEqual(self.client.post('/api/zalo/send').status_code, 404)

    def test_access_logging_redacts_callback_query_preserving_other_api_logs(self):
        module = importlib.import_module('app.services.zalo_logging')
        for path in ('/api/zalo/callback?code=private&state=private', '/api/zalo/callback/?code=private'):
            record = logging.LogRecord('uvicorn.access', 20, '', 1, '%s - "%s %s HTTP/%s" %d',
                                       ('client', 'GET', path, '1.1', 200), None)
            module.ZaloCallbackLogFilter().filter(record)
            self.assertNotIn('private', record.getMessage())
        record = logging.LogRecord('uvicorn.access', 20, '', 1, '%s - "%s %s HTTP/%s" %d',
                                   ('client', 'GET', '/api/v1/projects?offset=5', '1.1', 200), None)
        module.ZaloCallbackLogFilter().filter(record)
        self.assertIn('offset=5', record.getMessage())

    def test_secrets_are_masked_in_config_repr(self):
        self.assertNotIn('synthetic-app-secret', repr(self.config))
        self.assertNotIn(self.key, repr(self.config))


if __name__ == '__main__':
    unittest.main()
