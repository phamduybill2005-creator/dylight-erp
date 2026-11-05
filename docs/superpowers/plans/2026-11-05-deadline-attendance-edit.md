# Deadline and attendance implementation plan

**Goal:** Identify and open projects from reminders; let ADMIN correct existing attendance times inline.
**Architecture:** Extend the existing attendance update endpoint and inline detail UI. Keep date/time validation on the server and log changes. Use direct Next links for reminders.
**Tech Stack:** FastAPI, SQLAlchemy, Next.js, React, TypeScript.
**Spec:** docs/superpowers/specs/2026-11-05-deadline-attendance-edit-design.md

## Constraints and review focus

Only ADMIN can change times, including explicit null fields. At least one time must remain. Timezone-aware input normalizes to Vietnam time before validating the work date. Reject inverted ranges and cross-company records. Preserve manual corrections when machine data is synchronized.

## Tasks

- [x] Add backend endpoint tests for successful correction, persistence, summary, audit, permissions, invalid dates/ranges and empty records.
- [x] Extend AttendanceUpdate and existing PUT endpoint with ADMIN validation and audit.
- [x] Preserve corrected time fields during machine synchronization using per-field correction flags.
- [x] Add inline edit controls with save/cancel/errors and refresh detail, day list and summary.
- [x] Add project code and direct project links to reminders and desktop notification copy.
- [x] Run backend tests, frontend tests and production build; review diff.
- [ ] Commit and push.

## Execution notes

- Native execution; scoped endpoint tests observed failing before implementation.
- Review found partial machine batches could invert a corrected range: added failing regression, range guards, and shared row locks across time writers.
- Review found approved late leave missing from PUT response: regression then apply exemption after persistence/audit, without storing a manual override.
- Correction flags are per-field so an untouched missing/earlier punch can still synchronize.
- Verification: full backend suite 287 passed; final attendance/credit/late suite 32 passed; frontend suite 98 plus new rendered-link test passed; production build passed.
