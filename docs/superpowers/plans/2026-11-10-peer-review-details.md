# Peer review score details

User explicitly requested click on “1 phiếu” beneath Chất lượng công việc / Tập thể to see evaluator names and their average points, then expand each to see criterion scores. Implement and push to main. Existing month/quarter scoring formulas and write flows stay unchanged. Latest user request authorizes named details for the existing DIRECTOR/ADMIN summary surface, superseding aggregate-only peer review comments; ordinary staff/manager privacy stays intact.

## Contract

GET `/peer-reviews/details?evaluatee_id={id}&kind=QUALITY|TEAM&from_month=YYYY-MM&to_month=YYYY-MM`, DIRECTOR + ADMIN only. Same-company target and same-company evaluator rows. Include historical inactive evaluators/targets. Validate year>=1, ordered range <=24 months, valid kind, unknown/foreign target404; empty valid request returns evaluators[]. Return `{evaluatee_id,evaluatee_name,kind,from_month,to_month,count,evaluators:[{evaluator_id,evaluator_name,avg,count,reviews:[{id,month,scores:[s1,s2,s3],avg,updated_at}]}]}`. Count means ballot count, not distinct people. Each evaluator avg is unrounded arithmetic mean across their ballot scores in the requested period; UI formats up to2decimals. Deterministic evaluator ordering and month order. Scores/criteria order follows existing QUALITY and TEAM forms. No identity fields added to ordinary /mine or /summary.

Frontend: both desktop/mobile score cells keep current average and turn only positive ballot counts into accessible buttons. Open one portal dialog with target name, category and selected period. Each evaluator row has name, avg/5 and expand/collapse control, revealing actual monthly ballots with three labeled scores. Multiple months must be labeled, never flattened into an unlabeled criterion average. Scrollable dialog, close control/Escape, loading/error+retry/empty states. Changes of user/period/category cannot flash stale identities or let earlier responses overwrite newer selection. Live evaluation/focus/poll refresh while open follows existing useAutoRefresh. Load on demand, preserve current table/export totals and no detail export changes. Access guard current role ADMIN/DIRECTOR (real-user preview behavior consistent existing page).

Update peer-review UI copy/comments so ordinary users are told ratings are not public to coworkers; director/admin can inspect details. No unrelated legacy Evaluation received/given privacy changes.

## Execution

- [x] Backend TDD authorization, target/tenant/kind/range filters, per-evaluator averages, multiple months, overwrite/delete reflecting current data, empty and historical records.
- [x] Frontend TDD click wiring both cells/layouts, named averages/criterion labels/dropdown, correct month/quarter scope, loading/error/retry/empty, stale requests and refresh/close.
- [x] Existing frontend evaluation-attendance test file had8 failing tests at baseline after prior peer-review feature commits (manual scores retired / export shape changed). Updated stale contracts to current automatic peer averages; retained attendance refresh/error/quarter/export coverage and replaced obsolete score-save races with current period/GET races.
- [x] Full backend/frontend tests, TypeScript and diff checks; scoped independent review complete with no actionable P1/P2 findings. Integrate task files only under authorized commit/push workflow. Preserve untracked mobile/skill directories.

Fresh verification: backend463/463, frontend155/155, TypeScript and diff checks pass. Criterion labels shared with the original peer form; named details are fetched only when opened and use existing evaluation/focus/poll refresh. No migration or live deployment/browser verification performed.
