# Evaluation logic audit and fixes

User asks to check the full evaluation flow after confirming the reviewed month feeds the same summary month. Audit scopes calendar/locks, peer eligibility, save/read/summary ownership, completion and morning Zalo reminders. No production database or real messaging is accessed. Preserve scoring formulas and historical data; never relabel old months automatically.

Verified defects: API QUALITY writes do not enforce the form's department rule; active unapproved targets can receive votes; concurrent first writes for the same key can raise an unhandled unique violation. Frontend retains previous-month rows during new-month reads, treats failed reads as empty, and allows outdated load/mutation responses to overwrite the currently viewed selection.

Backend: share normalized department policy between API and completion, reject unapproved targets, constrain own reads/deletes by company, and narrowly recover only concurrent insert conflicts by rollback/reload/overwrite within the same approved period and key. Preserve empty-voter-department unrestricted behavior of current forms. Add API-to-summary integration proving October votes submitted in November only affect October, and concurrent two-session regression.

Frontend: month-owned load state, disable mutations until current data loads, actionable retry on read errors, selection-owned mutation effects, synchronous mutation guard and selectors disabled during writes. Historical browsing and reminder links stay available; midnight/calendar policies unchanged. Independent frontend implementer works only on ballot page and tests; root handles backend.

- [x] Observe failing regression tests for verified API and frontend problems.
- [x] Implement scoped fixes, preserving historical scores and business formulas.
- [x] Run full backend/frontend suites and TypeScript, and review final fixes. Integrate through the established Git workflow.

Existing calendar/month alignment, morning schedule, durable day/month claims, empty-list suppression, tenant-scoped completion, score range and named-detail authorization were reviewed without finding a defect in their current behavior. Provider outage/ambiguous send behavior remains best-effort at-most-once, not guaranteed delivery.

Verification: full backend unittest discovery passed 511 tests; full frontend Node suite passed 179 tests; TypeScript `tsc --noEmit --incremental false` passed. The API-to-summary regression submits October ballots in November and proves November receives neither score. Additional regressions cover tenant-isolated own reads/deletes and a concurrent insert crossing the voting deadline. Frontend regressions exercise deferred reads/writes, error retries, duplicate clicks, navigation away and back during pending writes, same-id score refresh, midnight header rollover, and department eligibility including the original unrestricted empty-department case. No live VPS/database/browser or Zalo delivery verification was performed.

Independent API review and final combined review reported no actionable findings. API review's additional deadline-collision regression was added and passed in the full backend run. Final frontend eligibility alignment was independently rerun through all 179 tests and TypeScript before integration.
