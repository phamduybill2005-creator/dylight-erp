# Attendance Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for integration. Independent frontend and regression-test work may be delegated with superpowers:dispatching-parallel-agents.

**Goal:** Implement approved steps 1–4: AM/PM reconciliation, durable ADMIN permission, live approved-leave integration and attendance management UI.
**Architecture:** Pure per-session assessor plus tenant-scoped read assembly. Persist only explicit administrative decisions and data coverage; derive current results from attendance, schedule and leave on every read.
**Tech Stack:** FastAPI, SQLAlchemy, Pydantic, SQLite regression tests; Next.js, React, Tailwind and Node tests.
**Spec:** docs/superpowers/specs/2026-11-06-attendance-reconciliation-design.md

## Global Constraints
- No evaluation/payroll rewrite; no group messages. Preserve real punches, legacy permissions and existing leave submission cutoff.
- Tenant isolation; only ADMIN may mutate reconciliation permissions/coverage. Coverage never inferred from sync success alone.
- Afternoon lateness only for afternoon-only attendance. Approved/pending/canceled leave and AM/PM scopes remain distinct.
- Preserve unrelated untracked mobile files. Use the existing codex branch.

## Review Focus
- No-row employees and offline/stale sources must never disappear or be automatically penalized.
- Pending/rejected/canceled and wrong-session late permissions must not excuse attendance.
- A morning check-in without checkout cannot prove afternoon absence; checkout-only data needs verification.
- Source=SCHEDULE means time off duty, not approved absence; personal hours and holidays must be honored.
- Permissions survive resync; reset and mutation audits are atomic and company scoped.

## Tasks
1. Backend tests and assessor
   - [x] Write failing regression cases in backend/tests/test_attendance_reconciliation.py for literal AM/PM outcomes, uncertainty and permissions.
   - [x] Implement backend/app/services/attendance_reconciliation.py with assess_day(user, work_date, attendance, leaves, overrides, confirmations, now) -> dict and reconcile(db, company_id, from_date, to_date, user_id=None, now=None) -> dict.
   - [x] Run targeted tests; retain baseline failures separately.
2. Persistence and API
   - [x] Add AttendanceSessionOverride and AttendanceDataConfirmation models, migration and startup-compatible leave column addition.
   - [x] Add schemas and static reconciliation routes before /{attendance_id}; test tenant/read restrictions, ADMIN writes, reason/time validation, reset/audit and approval/withdrawal re-read.
   - [x] Preserve legacy time edits and narrow existing leave exemption to the applicable arrival session.
3. Frontend (independent implementation against the spec's API contract)
   - [x] Add types/API and reconciliation panel; integrate team and personal attendance without removing existing tools.
   - [x] Add late arrival-time input and request display; poll refresh and refresh after leave/time edits.
   - [x] Run frontend tests and TypeScript.
4. Integration and review
   - [x] Full backend suite, full frontend suite, TypeScript, diff check and meaningful UI/render verification.
   - [x] Fresh independent review; address substantive findings and verify again.
   - [ ] Commit only task files and push under the user's established workflow; report actual checks and deployment limits.

## Progress / decisions
- Baseline: 290 existing backend tests passed; the first 3 new endpoint tests failed as expected. Windows sandbox blocks TestClient's local socketpair; API suites run through the approved escalated unittest command.
- Approved conversation is the execution authorization; proceed without a second approval gate.
- Implemented service, models, audited routes, migration/startup compatibility, frontend and leave-arrival input. Direct service/API, schema, UI-render and interaction regressions are present.
- Review rulings: retire all new legacy is_late_override writes; preserve existing stored flags. Historical punches/approved leave take precedence over account creation; no-evidence pre-account days need review. Closed-session singleton machine evidence cannot prove entry/absence. Personal AM end is used consistently for closure and presence. Any still-valid approved late request may qualify. Audit details snapshot actor id/name immutably.
- Independent review's six findings and two scoped boundary refinements were addressed with regression tests. Scoped rereview found no remaining blocker.
- Targeted backend 94 tests passed; frontend 115 tests and TypeScript passed before final whole-suite check.
- Browser preview could not connect to localhost from the available browser runtime; do not claim visual browser verification. Real React render and interaction fixtures cover user-visible statuses, permissions, failures, dates and times.
- Final verification: 363 backend tests, 115 frontend tests, TypeScript and diff checks passed. New targeted backend/audit regressions total 94. Existing dependency deprecation warnings remain outside this feature. Live production data and deployment were not accessed.
