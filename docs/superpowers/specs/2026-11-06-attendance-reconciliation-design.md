# Đối chiếu nghỉ phép và chấm công — bước 1–4

User approved implementing the proposed four stages on 2026-11-06. No evaluation/payroll changes or group notifications are in scope.

## Rules
- Assess each active, approved employee and scheduled AM/PM, including employees with no attendance row.
- Default workweek Monday–Saturday. Sunday and configured holiday dates are not scheduled. Approved source=SCHEDULE requests exclude the indicated sessions; they are not paid leave. Latest approved schedule for the date wins.
- Use the current first/last punch. Assess afternoon lateness only for an afternoon-only arrival (no morning presence); a full-day worker is not assessed twice.
- Morning/afternoon approved leave and late permission apply only to their own session. Pending applications do not count as approved. A late request never excuses an entirely absent session.
- Use company shift times and applicable personal work_start/work_end. Approved lateness may have an optional allowed_arrival_time; exceeding that time remains unexcused. Legacy requests without a time remain valid for the specified session.
- Do not infer unexcused absence from an empty API response or a successful synchronization alone. After a session ends an ADMIN can confirm that the day's/session's source data was checked complete. Until then missing data remains WAITING_DATA. Missing check-in/out evidence remains NEEDS_REVIEW even when coverage is confirmed.
- ADMIN may record EXCUSED_LATE or EXCUSED_ABSENCE, the authorizing person's name and a required reason, or reset to automatic. Record who changed it and the before/after values in durable audit history in the same transaction. Never change real punches for permission, never override the decision on sync.
- Reconcile dynamically on read, so approval, withdrawal, new punches and corrections take effect without stale cached assessments.
- Existing 19:00 submission cutoff remains; external permission uses ADMIN confirmation instead of a retroactive leave request.

## Interface
GET /attendance/reconciliation?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD&user_id=optional (max 31 days):
{rows:[{user_id,full_name,department,work_date,attendance_id,check_in,check_out,morning:Session,afternoon:Session,needs_attention}],confirmations:[{work_date,session,confirmed_by,confirmed_at,reason}]}

Session = {session:"AM"|"PM",status,late_minutes,explanation,leave_id:null|number,permission_source:null|"LEAVE"|"ADMIN",override:null|{decision,reason,approved_by,recorded_by,updated_at},data_confirmed:boolean}.
status = PRESENT|EXCUSED_ABSENCE|UNEXCUSED_ABSENCE|EXCUSED_LATE|UNEXCUSED_LATE|PENDING_APPROVAL|NEEDS_REVIEW|WAITING_DATA|NOT_SCHEDULED|NOT_FINISHED.

PUT /attendance/reconciliation/override:
{user_id,work_date,session:"AM"|"PM",decision:"EXCUSED_LATE"|"EXCUSED_ABSENCE"|null,reason,approved_by:string}; ADMIN only; null resets automatic; returns updated day row.

POST /attendance/reconciliation/confirm-data:
{work_date,session:"AM"|"PM",reason}; ADMIN only, only after session closes; returns confirmation.

All reads tenant-isolated; non-senior employees can see only themselves. Managers/directors can read team results; only ADMIN can confirm data or permissions. Errors preserve UI drafts.

## UI
Attendance tab: one reconciliation panel bound to the selected day, department/status filters, AM/PM badges, source reasons, request link /leave?leave_id=N (verify existing deep-link parameter), admin permission form and data-completeness confirmation. Personal attendance shows own results. Existing time editor remains separate.
Leave tab: optional stored allowed_arrival_time for late forms (required by new UI), display on request details/cards. Existing pending approval workflow remains.

## Rulings
- Work in the existing codex branch/workspace to preserve the user's established edit-and-push workflow; do not create a new worktree or touch untracked mobile artifacts.
- Coverage confirmation is explicit and tenant/session scoped because current Yunatt integration cannot prove that an offline machine uploaded all missing records.
- First/last punches suffice for the user's clarified afternoon-only rule; do not introduce a four-punch requirement.
