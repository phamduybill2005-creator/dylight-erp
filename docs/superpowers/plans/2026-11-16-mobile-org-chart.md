# Mobile Organization Chart Implementation Plan

> **For agentic workers:** Use native inline execution for this small, coupled component change. Steps use checkbox syntax for tracking.

**Goal:** Replace the oversized phone dashboard chart with a compact card and usable full-screen viewer.

**Architecture:** Keep chart data and editing in CompanyOrgChart. Extract a viewer and shared native dialog into a focused UI component, using the existing chart markup as children.

**Tech Stack:** Next.js 14, React 18, TypeScript, Tailwind, native dialog and ResizeObserver; no added dependencies.

**Spec:** `docs/superpowers/specs/2026-11-16-mobile-org-chart-design.md`

## Global Constraints

- Mobile uses the existing `lg` breakpoint; desktop retains its inline chart.
- Preserve backend APIs, permissions, chart colors, hierarchy, profile matching, and save/cancel behavior.
- Native dialogs must isolate focus, restore focus, lock background scroll, and respect safe areas.

## Review Focus

- Initially unmeasured or empty canvas must never produce invalid zoom dimensions.
- Chart changes and orientation changes must recalculate automatic fit.
- Nested sheets must appear above the viewer and close before the viewer on Escape.
- Closing a failed/unsaved edit must not silently discard data.
- Viewport and toolbar must remain usable at 360px width and in landscape.

### Task 1: Compact card and full-screen viewer

**Files:** Modify `frontend/src/components/company-org-chart.tsx`; create `frontend/src/components/org-chart-viewer.tsx`; test `frontend/tests/org-chart.test.cjs`.

**Interfaces:** CompanyOrgChart owns saved/draft chart state. OrgChartViewer receives children, toolbar and onClose. OrgChartDialog supplies a portal-backed native modal for the viewer and sheets.

- [x] Add behavior tests for opening the viewer, closing without writes, permission gating, failed saves retaining drafts, nested profile/editor sheets, and fit/zoom bounds; run before implementation to observe missing behavior.
- [x] Implement dialog lifecycle, measured fitting, bounded zoom, native touch scrolling, mouse panning, and compact mobile card.
- [x] Reuse the existing chart and forms, moving forms into native sheets. Confirm unsaved edits before closing.
- [x] Run `node --test tests/org-chart.test.cjs`, then `node --test tests/*.test.cjs` and `node node_modules/typescript/bin/tsc --noEmit --incremental false` from frontend. Expected: all pass; report pre-existing failures separately.
- [x] Inspect the running UI at phone and desktop widths, including zoom, sheets, dismissal and editing. Review diff and record verification.

## Verification — 2026-11-16

- `node --test tests/*.test.cjs`: 183 passed, 0 failed, including 4 new chart behavior/fit tests.
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`: exit 0.
- `git diff --check`: clean.
- Browser checks with a temporary local fixture using the real CompanyOrgChart component: 430x932 and 360x780 portrait, 932x430 landscape, 1280x900 desktop. All chart nodes fit within the initial mobile viewport; zoom reaches and stops at 200%; fit resets the camera; nested profile/editor dialogs and Escape work; body scrolling and trigger focus restore after closing.
- Temporary preview route and generated route type were removed after inspection. No live backend data was modified.
- Independent read-only code review: no actionable defects. Manual zoom intentionally remains selected on resize; the fit button reapplies the current automatic fit.
- Screenshots saved in the session visualization directory: org-chart-mobile-card.png and org-chart-mobile-viewer.png.
- The user requested committing and pushing this change to the deployment branch after verification.
