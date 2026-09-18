# Mobile Interface Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the authenticated mobile presentation so core information is readable at 360–430 px without page-level horizontal overflow or floating controls covering content.

**Architecture:** Keep all API calls, state and desktop tables in their current pages. Add a reusable mobile navigation model and page-specific mobile card/list renderers behind responsive breakpoints; desktop renderers remain the source of full tabular detail.

**Tech Stack:** Next.js 14, React 18, TypeScript, Tailwind CSS, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-18-mobile-interface-redesign.md`

## Global Constraints

- Preserve APIs, mutations, authorization and desktop behavior.
- Support viewport widths 360, 390 and 430 px without page-level horizontal overflow.
- Keep all primary touch targets near 44 px high.
- Do not add runtime dependencies.

---

### Task 1: Mobile application shell

**Files:**
- Create: `frontend/src/lib/mobile-navigation.ts`
- Modify: `frontend/src/components/app-shell.tsx`
- Modify: `frontend/src/components/chat-widget.tsx`
- Modify: `frontend/src/components/notifications-bell.tsx`
- Test: `frontend/tests/mobile-navigation.test.cjs`

- [ ] Write a failing behavior test proving four primary destinations are returned and active secondary destinations select `Thêm`.
- [ ] Run `node --test tests/mobile-navigation.test.cjs` and confirm the expected failure.
- [ ] Implement `buildMobileNavigation` and use it for a fixed bottom navigation plus an accessible More sheet.
- [ ] Render chat and notification triggers inside the top bar and remove their floating mobile placement.
- [ ] Re-run the navigation test.

### Task 2: Progress and project detail

**Files:**
- Modify: `frontend/src/app/timesheet/page.tsx`
- Modify: `frontend/src/app/projects/[id]/page.tsx`
- Test: `frontend/tests/mobile-view-models.test.cjs`

- [ ] Write failing tests for mobile project totals and visible day details.
- [ ] Run the focused tests and confirm failure.
- [ ] Add a mobile progress list with expandable daily detail; keep the current grid at `lg` and above.
- [ ] Stack the project heading and section toolbars, group secondary actions, and make edit dates single-column on mobile.
- [ ] Re-run focused tests and build.

### Task 3: Project and revenue lists

**Files:**
- Modify: `frontend/src/app/projects/page.tsx`
- Modify: `frontend/src/app/revenue/page.tsx`
- Test: `frontend/tests/mobile-view-models.test.cjs`

- [ ] Add failing tests for project and revenue card view models.
- [ ] Run focused tests and confirm failure.
- [ ] Add mobile cards with project identity, status, owner/deadline and revenue as the primary values.
- [ ] Hide only the wide table below `lg`; retain all existing edit and row actions through cards or detail links.
- [ ] Re-run focused tests.

### Task 4: Work schedule and people workflows

**Files:**
- Modify: `frontend/src/app/work-schedule/page.tsx`
- Modify: `frontend/src/app/evaluations/page.tsx`
- Modify: `frontend/src/app/leave/page.tsx`
- Modify: `frontend/src/app/attendance/page.tsx`

- [ ] Add mobile list renderers that expose the important values and actions before wide tables.
- [ ] Collapse secondary exports, legends and filters where they obscure the data.
- [ ] Keep desktop tables unchanged behind `lg:block` wrappers.
- [ ] Run the complete Node test suite.

### Task 5: Verification

**Files:**
- Modify only files required by defects found during verification.

- [ ] Run `npm test` in `frontend`.
- [ ] Run `npm run build` in `frontend`.
- [ ] Inspect `/`, `/timesheet`, `/projects`, a project detail, `/revenue`, `/work-schedule`, `/attendance`, `/employees`, `/leave`, and `/evaluations` at 360, 390 and 430 px.
- [ ] Confirm the document width never exceeds the viewport and primary actions remain reachable.
