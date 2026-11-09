# Automatic attitude score

User approved implementing Ý thức only after the design discussion. Compute in background, display points only (no score breakdown panel), update on ERP data changes using existing SSE/focus/poll mechanism. Preserve CL/HN manual workflows. Existing workspace and push-main workflow authorized; preserve unrelated untracked mobile/skill directories.

## Rules

Every eligible month starts at 5 points, floor0. Eligibility starts at first real punch across all history as already implemented. No score before first employment month, for never-punched employees, or future months. Unknown/pending source data never earns a violation. Monthly lateness/early events ordered chronologically share TWO free events regardless CP/KP; from event3 onward CP costs.25 and KP costs.75. Both deductions start at event3, per user's explicit correction. Absence KP costs1/day (.5/session) independent of that allowance. Confirmed forgotten IN or OUT costs.1/event when not reported on the workday; reported on workday costs0. Today's unreported forgotten event cannot be penalized until the day is over. Missing clocks alone are never forgotten; Admin confirmation required. Preserve reason/authorizer/actor history and real clock edits separately.

Early departure: derive only from a known paired valid actual clock interval and a PRESENT/EXCUSED_LATE/UNEXCUSED_LATE session. Compare checkout to applicable shift_end (personal schedule supported). No lunch-return requirement. Session's clock evidence must actually cover it. Closed morning-only sessions may be early; full-day checkout before afternoon starts means possible PM absence, not PM early as well. Approved absence is not early permission. EXCUSED_EARLY Admin override excuses early only, never lateness; EXCUSED_LATE does not excuse early. Pending/unpaired/conflicting evidence produces no early penalty. At most one early checkout event per day. Early and late on same day count as separate chronological events.

## Interfaces

Existing permission decision union extends with `EXCUSED_EARLY` and explicit combined `EXCUSED_LATE_EARLY`; existing batch/single APIs and audit still apply. Combined permission preserves both approvals in one session; either single permission excuses only its own event kind. Each session result adds optional `early_status: 'EXCUSED_EARLY'|'UNEXCUSED_EARLY'|null` and `early_minutes:number` (defaults null/0). Primary status and existing monthly four counts remain unchanged.

New table `attendance_forgot_punches`: unique(company,user,work_date,punch IN/OUT), decision nullable FORGOT (tombstone reset), reported_at nullable Vietnam-local datetime, reason, approved_by, recorded_by_id/name, timestamps. New `PUT /attendance/reconciliation/forgot-punch`, ADMIN-only, active approved same-company target, nonfuture date; body `{user_id,work_date,punch:'IN'|'OUT',decision:'FORGOT'|null,reported_at:string|null,reason,approved_by}`. Validate/normalize timestamp to VN naive, no future report or report before workdate. Existing per-day result adds `forgot_punches` list of active confirmations with punch/decision/reported_at/reason/approved_by/recorded_by/updated_at. No synthesized Attendance or data coverage. Reason+authorizer required for grant/reset; transaction audit+commit; publish attendance event. Startup create_all handles new table; idempotent Alembic revision follows f48a11b6c920.

`attendance_totals` additionally returns `attitude_points` nullable0..5 and weighted `score_attitude` nullable0..25 per (user,month). It aggregates ordered known late+early events and forgotten confirmations, applies first-punch gate and monthly reset. Reconcile rows carry required signals; no score DB writes. Month-review GET and score PUT responses use derived fields. Reject score_attitude writes (including mixed payload) like other attendance-derived fields; old saved values kept but ignored. Quality/team unchanged.

Frontend month review adds attitude_points; displays Ý thức as `x/5` read-only for all users, weighted score_attitude used in result+Excel. Quarter YT averages eligible monthly YT independently of manual quality/team; do not dilute with blank/pre-employment/future months or turn missing CL/HN into zero. Result stays absent until all three components have data. Keep precision through calculations, format up to2decimals. Excel matches visible source and exposes raw YT plus weighted contribution. Existing attendance-derived stats live refresh retained and old GET/score races remain covered.

Compact Admin day editor: add early permission option; one small forgotten-punch form (IN/OUT, confirm FORGOT or reset, reported datetime optional, reason+authorizer) backed by the new endpoint and initialized from saved confirmation. Required confirmation still available after actual clock correction. No scoring details panel. Validation failures retain draft; disable conflicting writes while saving; existing tenant/real Admin guard and historical read-only behavior preserved. Local mutation uses existing attendance-reconciliation-changed event.

## Work

- [x] Backend reconciliation/forgot model+API/migration with RED tests, then GREEN.
- [x] Root scoring service/month-review API integration with RED tests for threshold chronology, monthly reset, partial-day absences, reports/uncertainty/first-punch, dynamic edits and score immutability.
- [x] Frontend real-page/form RED tests then implement hidden computation/read-only points and minimal Admin input; month/quarter/export and refresh tests.
- [x] Full backend/frontend suites, TypeScript/diff checks, independent review and finding fixes complete. Integrate using approved commit/push workflow.

## Important boundaries

No CL/HN evaluation redesign, auto score freeze, or group messages. No auto 0.1 from a lone punch. No early penalty while evidence pending. Report time means actual time employee notified, not Admin entry time. No unexplained score data migrations. User authorization replaces extra approval gates.

## Verification and review

- Root score tests observed RED before implementation; final20 score tests cover monthly grace/chronology, mixed decimal precision, floor0, source uncertainty, first-punch eligibility, live permission/reset changes, forgotten report timezone and day closure, old manual values and write rejection.
- Independent review found missing forgotten-only historical roster evidence and a personal PM shift starting before13:30 not receiving early signals. Both reproduced with RED regressions and fixed. Attendance summary also preserves forgotten history after deactivation/reset.
- Added closed-shift guard (temporary checkout cannot become early), unresolved confirmed forgotten clocks stay NEEDS_REVIEW rather than generating an absence penalty, and explicit combined permission to preserve two approvals in one session. Off-duty/fully approved-leave days do not receive a forgotten-clock penalty.
- Final scoped reviewer runtime checks passed with no remaining findings. Fresh integrated backend449/449 tests and frontend151/151 tests pass; TypeScript and diff checks pass. Migration tested for startup-created and missing table with repeated upgrades. No live server migration/deploy/browser verification claimed.
