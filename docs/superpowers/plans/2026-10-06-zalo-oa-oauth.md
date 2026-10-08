# Zalo OA OAuth — approved implementation plan

User approval: 2026-10-06, implementation local only. No live Zalo requests, real messages, production migrations, deployment or restarts. Preserve existing frontend and `.gitignore` changes.

Architecture: FastAPI `/api/zalo`, backend-only httpx, two separate SQLAlchemy models with UTC timestamps, Fernet encryption, hashed state and browser binding. Durable single-use callback and refresh claims; compare-and-swap prevents late refresh overwriting a new connection. New tables are excluded from ERP startup DDL.

- [x] Test first: PKCE/state randomness, one-time callback, expiry, browser binding, role/tenant/OA checks, encrypted storage, token protocol, refresh rotation/failure/races, filtered GMF output and service payload.
- [x] Implement `zalo_models`, `zalo_repository`, `zalo_oauth_service`, `zalo_oa_service` and router. Settings remain optional until integration use. Initiation requires same callback host and ERP ADMIN, no frontend edits.
- [x] Register router outside `/api/v1`; sanitize Uvicorn callback query logs; no-store/no-referrer on Zalo responses and errors.
- [x] Create isolated Alembic revision. Add explicit helper for unknown Alembic baselines that applies only this revision (not `upgrade head`), with an advisory lock and schema checks; default check-only. Test only on disposable SQLite and PostgreSQL SQL generation.
- [x] Environment examples, Docker context exclusions, VPS instructions and manual maintenance script. No changes to Caddy/Compose are needed for the current env_file deployment.
- [x] Full backend test suite, syntax and dependency checks, untouched-file hash comparison, independent security review and final inventory.

Review focus: concurrent reconnect versus refresh; pending refresh after process crash; duplicated callbacks; DB failure after upstream rotation; no secret values in logs/responses/build context.

Runtime: Python 3.12 test venv under ignored `backend/.venv/zalo-test`. All tests force memory SQLite, mocked HTTP and disabled background jobs; never load a live .env. Working in the supplied checkout under the user's explicit approval.

Progress: original OAuth suite 18 RED (modules absent) → 18 GREEN. Migration suite 7 RED (revision absent) → 7 GREEN. ERP startup and five extra persistence/CLI regression checks → 31 GREEN. Full backend before identity fix: 142/142 pass. `pip check`, compileall and `git diff --check` pass. Hash comparison confirms frontend, .gitignore, Caddyfile, both Compose files and local dev.db unchanged.

Prior review/version (superseded by the minimal-permission request below): fresh read-only reviewer found one Important issue (browser-controlled OA identity) and one Minor coverage gap. Paused implementation, checked official getoa docs, and obtained user approval for the additional OA-information permission. That version authenticated exchanged token pairs through getoa; its identity regression tests and full 146-test suite passed.

Final: minor (deferred): simulate lost acknowledgement after successful refresh commit and failed recovery write, verifying persisted state with a fresh session. Existing tests cover DB failure before save, durable pending claim, conditional generation changes and ambiguous HTTP failure.

Final: Ruling: provider-side ordering of concurrent reconnect/refresh is not proven by mocked tests — enforce durable claims and generation predicates locally; verify provider semantics only in separately authorized staging integration — cost if provider invalidates a newer connection: ADMIN must reconnect.
Final: Ruling: real PostgreSQL locking and loaded VPS proxy/Docker configuration cannot be asserted from this local environment — SQL is compiled for PostgreSQL and disposable SQLite is tested; staging verification belongs before production deployment — cost if environment differs: do not proceed until verified.
Final: Ruling: existing frontend and .gitignore edits are excluded from this work — preserve exact pre-work diff hashes — cost if another process edits them concurrently: repeat scope verification.

Final verification: Python 3.12 `python -m unittest discover -s tests -v` → 146/146 PASS (35 Zalo tests), 13.026s; all provider HTTP mocked and all databases disposable. `pip check` → no broken requirements, compileall → PASS, `git diff --check` → PASS. Existing main.py contains unrelated trailing spaces outside this diff; left untouched. Protected diff/database hashes unchanged. Inventory: six tracked files modified, fifteen new source/config/test/documentation files. No real ERP migration, Zalo API call, Docker build, commit, deployment or production restart performed. PostgreSQL/VPS live checks remain separately authorized deployment prerequisites.

Minimal-permission follow-up (2026-10-06): user explicitly replaced the getoa requirement with callback `oa_id == ZALO_OA_ID`, transaction OA/company/admin validation, existing state/expiry/single-use/PKCE controls, and stable credential OA binding through refresh. Removed getoa entirely; no new diagnostic endpoint or permission. Core GMF services, router, repository and schema stay unchanged. Credential OA/app values now come from the validated transaction, not directly from the callback parameters.

Follow-up TDD: the new callback-and-refresh-without-profile-permission test failed on the previous mandatory getoa call (502 instead of 200), then passed after removal. Replaced the four provider-identity tests with minimal-permission success, missing/mismatched callback OA, transaction OA/company/admin mismatch, and mismatched stored-credential OA rejection. Existing token protocol/encryption/refresh failure tests retained. OAuth module 25/25 PASS.

Follow-up: Ruling: independent provider token-ownership verification is removed under the user's explicit design — validate callback OA against configuration and transaction before code exchange; retain authenticated ADMIN initiation and PKCE/state/browser controls — cost if a trusted ADMIN alters callback OA values: callback consistency alone cannot attest token ownership. VPS guide states this boundary and no OA-information permission is required.

Follow-up verification: full backend `python -m unittest discover -s tests -v` → 146/146 PASS (35 Zalo tests), 13.712s. `python -m compileall -q app alembic scripts tests` → PASS; `python -m pip check` → no broken requirements; `git diff --check` → PASS. Byte hashes confirm only OAuth service, OAuth tests, VPS guide and this ledger changed; GMF service, repository/router, frontend and production configuration remain unchanged. No production migration/deploy/restart or real OAuth/message requests performed.
