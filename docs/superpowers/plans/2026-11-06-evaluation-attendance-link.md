# Evaluation attendance link

User authorized implementation of the proposed next step: monthly evaluations derive excused/unexcused lateness and absence from the existing session reconciliation; ADMIN corrections update both screens. Implement in the existing workspace. Preserve unrelated untracked mobile/skill files.

## Design and interface

Use the reconciliation service at read time rather than copying totals into review records. Copying would become stale after leave approval, punch sync or ADMIN confirmation. Existing manually stored attendance counts remain in the database, but cease to override derived counts. Evaluation scores and ratings remain unchanged; no automatic score deduction or group message.

`GET /evaluations/month-reviews` keeps permissions and user/month keys. The four canonical fields `late_cp`, `late_kp`, `leave_cp`, `leave_kp` now always contain derived numbers. Lateness counts distinct days per CP/KP category (existing rules permit only one late session daily). Absence counts 0.5 day per qualifying session. Approved leave and external ADMIN permissions share the same reconciliation logic. `leave_cp_auto` remains an alias for computed leave_cp for compatibility. New `attendance_pending_sessions` counts NEEDS_REVIEW, WAITING_DATA or PENDING_APPROVAL sessions; never counts these as violations. Only dates through Vietnam today are counted; off-duty and future sessions do not count. Current-day approved leave may count immediately, matching attendance display. GET does not persist data.

Monthly roster uses active/approved company users, plus historical users with attendance, relevant leave, session overrides or saved review scores in the requested months. Explicit historical reads remain read-only for permission. Reconciliation must support an explicit user-id list for batched evaluation reads without changing the existing bulk API roster. Month endpoints retain maximum 24-month range and validate year >=1. Overview late_days uses the same reconciliation UNEXCUSED_LATE count; actual hours are unchanged.

`PUT /evaluations/month-reviews/{user_id}/{month}` remains DIRECTOR-only for score fields. Reject any attendance count fields with a clear instruction to edit the attendance date; do not silently ignore a mixed payload. Preserve existing saved score fields. Response includes current derived totals.

Frontend uses canonical derived fields for month, quarter and Excel; all four counts are read-only for every role, including DIRECTOR. Columns/tooltips distinguish lateness (lần) and absence (ngày); a compact pending-sessions hint is next to employee name. Existing score input is unchanged. Refresh overview + month reviews after attendance/leave/schedule events, focus and interval, with stale-response guards and no false zero on load error. No new large panel.

## Execution

- [x] Backend RED regression tests: all four statuses, halves, full-day PM rule, duplicate leaves, uncertainty, future/off-duty, approved/admin corrections/reset, roster, tenant/role, old manual values and score isolation.
- [x] Implement batched derived monthly service and integrate month-reviews/overview; retain existing actual-hour totals and score behavior.
- [x] Frontend tests before implementation; use computed counts in desktop/mobile/export and refresh the selected period safely.
- [x] Full backend/frontend tests, TypeScript and diff checks; independent code review; resolve material findings.
- [ ] Commit and push to main under the established user workflow; report test counts and test steps.

## Review focus

No double counting overlapping leave; no future penalties; no KP from unverified machine gaps; old manual values cannot mask a corrected permission; cross-month and old employee evidence are preserved; event refresh cannot overwrite a newer selected period.

## Verification ledger

- Initial backend tests reproduced missing derived values, double-counted overlapping leave, old manual values masking live attendance and overview using the old lateness flag. Implemented read-time aggregation; existing score tests now validate the intentional score-only write contract.
- Frontend RED tests reproduced editable attendance counts, missing pending/refresh/error handling. Added guards for score-save responses containing older attendance and period round trips.
- Independent review found historical evidence holders missing from the overview roster and an earlier background GET overwriting an acknowledged score save. Both fixes observed RED then GREEN. Added the empty older-GET case so a newly created score review is preserved too. Newer GET attendance is retained, while later GETs can reflect subsequent score edits.
- Final fresh verification: backend 402/402 tests, frontend 141/141 tests, TypeScript and diff checks pass. No production deploy or live-browser verification performed.
