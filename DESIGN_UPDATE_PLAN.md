# App-wide visual enhancement plan

## Design objective

Evolve the tracker into a calm, high-contrast shop-floor command console. The
redesign should make the next action obvious in glare, with gloves, on a phone
or at a desk. It is an information-hierarchy and workflow upgrade, not a
decorative reskin.

The existing product constraints remain fixed: zero runtime dependencies,
locally bundled fonts, inline icons, one offline HTML file, light and dark modes,
generous touch targets, short reduced-motion-aware transitions, and the current
three-way status control.

## What the current audit says

| Surface | Health | Main gap to solve |
|---|---|---|
| Rolling / FOM / CNC centres | Good foundation | Summary controls and Running Now push the actual queue below the fold, especially on phones. |
| Today | Strong | All cards carry similar weight; work needing action this shift should dominate informational counts. |
| Rush | Strong | Owner, due time and reason compete; unassigned rush work needs a clearer warning. |
| Back Orders | Good foundation | Needs the same priority and ownership hierarchy as Rush for faster scanning. |
| Staging | Functional | Repeating a shift select plus a Staged button for every line makes a common action two steps. |
| Shift Update | Needs redesign | A long 13-machine form and empty grid space make completion slow and missing entries hard to find. |
| Setup | Functional | Onboarding, current health and destructive/rare controls compete instead of showing readiness at a glance. |
| Phone navigation | Functional | Dense horizontal navigation hides destinations and consumes attention before the work list. |

## Visual target first

Before production CSS changes, create three grounded visual directions using
the same representative states and real component density:

1. Rolling centre at desktop and 390 px phone width.
2. Today at desktop width.
3. Shift Update with partially completed machines.
4. Setup with sync configured and an import warning.

Each direction must keep the current data and controls; only hierarchy,
spacing, shape, color application and interaction presentation may differ. The
selected direction becomes the reference for implementation and screenshot
comparison. No new visual language should be committed before that selection.

## System-wide changes

### 1. Foundation and shell

- Consolidate color, spacing, type, radius, border, elevation, focus and motion
  tokens. Semantic roles should be `work`, `attention`, `blocked`, `success`,
  `danger` and `neutral`, with contrast verified in both themes.
- Establish a compact shop-floor type scale with tabular numerals for counts,
  work orders, quantities and times. Keep labels readable without relying on
  all-caps or color alone.
- Clarify the header as three zones: location, sync/operational health and user
  actions. Reduce badges that compete with the active page title.
- Preserve fast horizontal movement between centres on wide screens. On phones,
  keep the most-used destinations visible and put lower-frequency tools behind
  a clearly labelled overflow control rather than an unexplained clipped rail.
- Define consistent loading, empty, offline, storage-error, stale-import and
  permission states. Every failure state must include the safest next action.

### 2. Shared production-card language

- Use one task-card anatomy across centre queues, Rush, Back Orders, Today and
  Staging: priority/exception, work order and die, project/product, quantity,
  owner/machine, timing, status, then secondary actions.
- Give each card one obvious primary action. Move edits, notes, reassignment and
  history into a predictable secondary-actions area without shrinking targets.
- Treat rush, shortage, overdue and unassigned as composable exception markers;
  do not replace the task's actual status with an alert color.
- Offer comfortable and compact density on large screens while preserving at
  least 44 px interactive targets in both modes.

### 3. Work-centre pages

- Compress the top summary into actionable metrics: due now, blocked, running
  and remaining. Demote totals that do not change the operator's next decision.
- Make Running Now a compact persistent strip or collapsible region so the
  queue begins in the first phone viewport.
- Keep search and filters available without stacking a full control panel above
  every list. Show active filters and a one-tap reset.
- Strengthen group headers, selected-machine context and queue ownership while
  keeping all four centres visually consistent through the shared view.

### 4. Today, Rush and Back Orders

- Lead Today with “needs action this shift,” then separate in-progress work from
  informational schedule context.
- In Rush, make due time and owner the first scan line. Give “unassigned” a
  persistent high-priority treatment and demote total-piece decoration.
- In Back Orders, make unresolved quantity, assignee and last update immediately
  visible. Distinguish workbook-reported shortages from user-cleared overrides
  without exposing the tri-state implementation detail.
- Use identical filtering, ownership and secondary-action patterns across Rush
  and Back Orders.

### 5. Staging

- Set the next valid shift as the visible default and make “Stage” the one-tap
  primary action.
- Keep “choose another shift” available as a secondary control, with a clear
  confirmation of the selected destination.
- Group already staged, available and conflicting work so operators do not
  repeatedly inspect rows they cannot act on.

### 6. Shift Update

- Replace the continuous 13-machine wall with centre-grouped, collapsible
  sections and a persistent completion rail showing complete, incomplete and
  down machines.
- Provide “show incomplete” and next/previous incomplete navigation. Preserve
  entered text when sections collapse.
- Remove empty grid columns when a group has only one card; let the form use the
  available width with readable line lengths.
- Keep Save/Publish sticky, but show unsaved state, validation, sync result and
  the exact shift being updated next to it.
- Treat `DOWN` as a first-class machine state that changes which fields require
  attention without erasing existing notes.

### 7. Setup and safety surfaces

- Start with a readiness summary: workbook freshness, cloud/shared sync,
  device storage, operator identity and backup age, each marked Ready or Needs
  attention.
- Collapse the onboarding checklist after initial setup while keeping it
  recoverable through Help.
- Put imports in a guided two-file flow with source names, timestamps and the
  exact Shift Update source visible before confirmation.
- Separate day-to-day health from credential setup and destructive recovery.
  Keep backup/export obvious; keep reset deliberately behind confirmation.

## Delivery phases

### Phase 0 — Reference and acceptance baseline

- Approve one of the three visual directions.
- Freeze representative desktop and phone screenshots and the critical task
  flows used for comparison.
- Confirm the plan with one floor operator and one schedule owner before coding.

### Phase 1 — Tokens, shell and navigation

- Implement theme tokens, typography, focus treatment, header, responsive
  navigation and global status/error states.
- Verify every current route before moving into page-specific work.

### Phase 2 — Production cards and centre queues

- Build the shared card/action language in `views/centre.js`, then apply it to
  Today, Rush, Back Orders and Staging without changing task keys or data flows.
- Measure first-use phone depth: the first actionable queue item should appear
  in the initial viewport in the normal state.

### Phase 3 — Shift Update and Setup

- Introduce progressive completion for Shift Update and readiness-first Setup.
- Test unsaved, offline, stale import, storage failure and cloud failure states,
  not only the happy path.

### Phase 4 — Accessibility and release polish

- Verify 390, 768, 1280 and 1440 px widths, 200% zoom, keyboard-only operation,
  reduced motion, light/dark mode and print/standalone behavior.
- Check visible focus, accessible names, status announcements, contrast and
  target size; then run a real glove-and-glare floor walkthrough.
- Run the full `npm test` gate and compare final screenshots with the selected
  reference at matching viewport and state.

## Definition of done

- Operators can identify the next actionable line and its exception state in
  under three seconds on desktop and phone.
- The first actionable centre-queue item is visible without scrolling in the
  standard phone state.
- A shift lead can find every incomplete machine update without scanning all
  completed sections.
- Setup communicates whether the tracker is safe and current without opening
  advanced controls.
- No design change alters imported values, overlay keys, sync semantics, source
  workbook rules or the offline single-file build.
- All automated tests pass, production workbook counts are reviewed, and a
  floor operator signs off on tap comfort, glare readability and terminology.
