# Group evaluation follow-ups on days 2–5

User requests an implementation using the existing OA/common group, abandoning private messaging/Bot. Day 1's opening reminder stays. Days 2–5 send one early-day combined list of incomplete evaluators, only while any remain. User explicitly selected completion = both categories for all required colleagues.

Design: 08:00 Vietnam time. Daily follow-ups allow same-morning restart catch-up during 08:00–08:59 only, never afternoon sends or replaying prior dates. Add a separate durable company/day claim table, preserving existing company/month claims and historical data. Commit before provider HTTP; shared claim prevents repeats across workers/restarts/group changes and consumes ambiguous sends. An all-complete check also records the daily claim without sending, so later hourly polling cannot produce an extra list. Existing feature/global flags and OA credentials apply; no new Bot/config required.

Completion scope mirrors the current forms: active approved same-company non-directors vote; TEAM covers all other active approved non-directors; QUALITY covers colleagues sharing any normalized department with the voter (Vietnamese/Japanese aliases), or all colleagues if the voter has no department, matching existing UI. Self-votes, other-company/month rows and invalid/incomplete scores cannot satisfy completion. A voter with no required peers is complete. Public message includes only pending names and the previous reviewed month, deadline and form link, never scores or who rated whom.

Implement a focused completion query service, generalize existing claim repository to support the new daily model, frozen new migration/schema checks, and configured-worker-only isolated preparation. Keep day 1 behavior unchanged. Cron includes the new morning window; no web/frontend changes. Tests use disposable DB and fake HTTP only; no production access or live messages.

- [x] Added behavioral coverage for daily sending, once/date/empty checks/restart/concurrency/failure, completion scope, scheduler trigger and isolated schema preparation. Observed initial failures for missing completion logic and day-2 sends before implementation.
- [x] Implemented completion, daily model/migration/repository/sender/scheduler/schema and updated operational docs.
- [x] Full backend 503/503 passed; diff whitespace check clean. Independent scoped review found no actionable correctness issues. Stage only task files and push under the user's existing Git workflow authorization. No deployment or real group messages performed here.

New daily schema preparation shares the original PostgreSQL transaction advisory lock, preserves monthly/daily claims and the current Alembic version, and rejects malformed schemas before sending. The existing manual helper deliberately remains monthly-only; configured workers prepare both reminder tables. No frontend change or new environment variable is required.
