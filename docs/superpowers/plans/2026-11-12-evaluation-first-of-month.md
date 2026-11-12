# Evaluation reminder calendar update

User specification: evaluation takes place on days 1–5 each month; remind on day 1 on both web and the existing leave Zalo group. Automatically refer to the preceding month, including December of the preceding year in January.

Use the existing 08:00 Vietnam schedule and durable company/send-month claims. Keep old claims unchanged so an October 27 reminder cannot suppress the new November 1 reminder for October. Zalo checks only day 1, with same-day catch-up and no repeated sends. Web creates one notification per user during days 1–5; its popup follows the same window instead of Saturdays. Both display the previous month and deadline, and open the corresponding peer-review form. Do not change scoring/history.

Implementation uses a shared backend calendar/copy helper for web and Zalo, and a small frontend calendar/link helper. The voting form defaults to last month and honors valid reminder links, retaining manual month selection within the open page. Department/person filters stay remembered; the month resets on opening a new ballot so a stored current month cannot override a reminder. Preserve existing activation, explicit-disable, schema preparation, credential and duplicate-delivery protections. No live group test or production deployment. Git staging/push remains on hold after the prior permission rejection.

- [x] Updated behavioral tests for web window/dedup/year rollover, Zalo day 1/copy/year rollover/old claims, real scheduler trigger and frontend date/link/form behavior; observed failures before implementation.
- [x] Implemented shared schedule/copy, scheduler day, web notification, popup, links and form month.
- [x] Backend 476/476 and frontend 160/160 passed; TypeScript and diff whitespace checks clean. Runbook refreshed.

Final independent review identified query-only navigation retaining a manually selected month in an already-open ballot. Added a failing regression test, then made the form observe `useSearchParams().get("month")` with a Suspense boundary. Full frontend suite and TypeScript passed after the fix; reviewer confirmed it resolves the issue with no remaining actionable findings. Backend was unchanged after its successful full suite. No Git mutations, real group message or live deployment performed.

## User follow-up: close voting after day 5

Supersedes the original instruction to leave submission unrestricted. From 00:00 day 1 through the end of day 5 (Vietnam), only the previous month's QUALITY/TEAM ballots may be created, edited or withdrawn. At 00:00 day 6, all mutations close for everyone including admins. Later cycles never reopen older months. Read-only ballot/history/summary/details remain available. Reminder time stays 08:00 day 1, distinct from the voting start at midnight.

- [x] Observe RED for API create/update/delete cutoff, no admin bypass, old months/current month, January and UTC boundary, plus frontend calendar and an already-open form.
- [x] Enforce the shared voting policy on PUT/DELETE. Disable scoring/save/withdraw and refresh at Vietnam midnight/focus. Handlers recheck the current clock; server enforces regardless of client clock.
- [x] Verified 19 targeted backend tests, full backend 482/482, full frontend 162/162, TypeScript and diff whitespace checks. Independent deadline review found no actionable correctness issues. Git remains on hold; no production deployment or real Zalo messages.

## Release authorization

User subsequently explicitly authorized pushing this completed change to Git for deployment. Integrate the reviewed and verified code on origin/main, leaving unrelated local files untouched. Deployment and any real Zalo delivery remain outside this local release operation.
