# Compact Attendance Days Implementation Plan

> **For agentic workers:** Use superpowers:dispatching-parallel-agents for independent frontend and backend regression tests; integrate and verify in this workspace.

**Goal:** Show a compact calendar-day list inside each employee's existing monthly attendance detail; use its adjacent pencil for ADMIN permissions, including no-punch days. User approved implementing and pushing for testing.
**Architecture:** Reuse existing per-session reconciliation. No standalone reconciliation panel. Separate actual attendance records from calendar rows; never manufacture punches to save permission. Use one atomic API request to grant/reset one or both sessions.
**Tech Stack:** React/Next.js/Tailwind; FastAPI/Pydantic/SQLAlchemy and existing tests.
**Spec:** User's latest screenshot/request in this chat supersedes the earlier large-panel presentation; underlying 2026-11-06-attendance-reconciliation-design rules remain.

## Global Constraints
- Keep compact date + pencil + short status badges + actual hours. AM/PM distinctions appear when results differ; approved full-day absence can use a single badge. Basis goes in tooltip/editor, not paragraphs on every row.
- Show every calendar day of selected month, including missing records and clearly labeled future/off-duty days. Existing note/time editing remains available for real records.
- Approved leave auto-labels the date/session; external permission requires explicit ADMIN action with reason/authorizer. No automatic permission from missing punches. Unknown source evidence remains unknown.
- Pencil exists on no-punch dates too; select Sáng/Chiều/Cả ngày and Nghỉ CP/Muộn CP/Đặt lại tự động. Preserve failed drafts. Full-day writes are atomic and audited; source confirmation is never silently company-wide from a person's editor.
- Existing monthly cards must include active approved roster members without punches, so leave-only employees can open detail. Preserve historical record holders and tenant/self restrictions.
- Do not change evaluations/payroll or send group messages. Preserve removed large-panel decision and unrelated untracked files.

## API addition
PUT /attendance/reconciliation/override-day body:
{user_id,work_date,sessions:["AM"]|["PM"]|["AM","PM"],decision:"EXCUSED_LATE"|"EXCUSED_ABSENCE"|null,reason,approved_by}
returns updated AttendanceReconciliationRow. ADMIN only, same validation as existing override; all selected sessions + audit commit or rollback together.

## Tasks
- [x] Write RED tests for atomic two-session permission, no-punch roster, isolation and validation.
- [x] Implement batch permission API and roster-complete monthly summary without changing actual hour totals.
- [x] Add compact monthly-day component/helper, existing employee detail integration and adjacent ADMIN pencil editor using the batch API.
- [x] Test full month, approved absence, external permission, reset, failed draft, readonly non-admin, empty/error distinctions, time editing and refresh after leave changes.
- [ ] Run relevant/full tests, TypeScript and diff checks; independent review; commit and push task files.

## Progress
- Working in the existing codex branch to preserve the established user workflow. No new approval gate; the user requested implementation and push.
- Independent review caught historical inactive/unapproved employees being omitted from explicit reconciliation reads. Fixed read eligibility separately from permission-write eligibility; historical approved leave remains visible and permission controls are read-only. Scoped review verified the fix with no remaining finding.
- Fresh verification after the historical fix: backend 385/385 tests pass, frontend 132/132 tests pass, TypeScript and diff checks pass. No live production/browser verification claimed.
