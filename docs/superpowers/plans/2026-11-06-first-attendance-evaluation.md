# Start evaluation attendance at first punch

User explicitly chose the employee's first attendance day as employment start after a new employee displayed 54 pending sessions. Apply the start to all derived evaluation attendance counts, including pending sessions; preserve actual records, leave applications and manual evaluation scores.

Implementation: one company/user scoped grouped MIN of work_date over all attendance history, with at least one real check-in/out no later than Vietnam now. Exclude empty rows, future dates and future-only clock values. Include the first day itself. Neither the selected month nor account creation determines the start. Recompute on read so older uploaded history changes the boundary immediately. Daily attendance still preserves historical evidence; evaluation ignores dates outside the inferred employment period.

- [x] Observe RED: prior month reproduces 54 pending; first punch Nov5 incorrectly leaves 8 instead of2; confirmed pre-employment source incorrectly counts absence.
- [x] Implement range gate and verify established employee regression fixtures have a real historical first punch.
- [x] Focused evaluation suite: 37 tests pass, including all-history lookup, empty/future records, first-day inclusion, approved leave after start, no punch, tenant scope and older-history backfill.
- [x] Full backend suite: 415 tests pass. Independent scoped review found no material issues. Diff checks pass; no frontend changes or database migration required. Integrate under the existing commit/push workflow.
