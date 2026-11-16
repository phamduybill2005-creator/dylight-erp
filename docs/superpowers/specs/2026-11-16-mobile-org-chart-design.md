# Mobile organization chart

The user selected approach 1: a compact dashboard card opening a full-screen organization chart on phones, ahead of packaging the web frontend as an app.

- Below the existing `lg` breakpoint, show a compact organization card with the number of chart entries and a “Xem sơ đồ” button. Keep the existing inline desktop chart.
- Open a viewport-sized native dialog above the app navigation. Fit the complete chart initially, offer zoom buttons and “Vừa màn hình”, and allow native touch scrolling and mouse dragging when zoomed in.
- Keep existing chart colors, branch structure, ERP profile matching, API calls, editing permissions, and save/cancel behavior. Display profiles and node editors in viewport-bound dialogs, with a bottom sheet presentation on phones.
- Closing an unsaved chart asks whether to discard the draft. Saving failures retain it. Escape closes the topmost dialog and focus returns to its trigger. Account for safe area insets and lock background scrolling while dialogs are open.
- No additional dependencies or backend changes.

## Approaches

1. Compact card plus full-screen viewer: selected by the user; gives the dashboard breathing room while preserving the complete diagram.
2. Collapsible vertical tree: easier to read individual names but weaker at showing the complete organization at a glance.

Implementation choices left to the builder: use React portals and native HTML dialogs for focus isolation, ResizeObserver for canvas sizing, and the existing Tailwind theme. Check narrow portrait, landscape, desktop, edit/save failure, and nested-dialog behavior.
