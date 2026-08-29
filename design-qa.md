# Mobile Production Queue Design QA

## Comparison target

- Source visual truth: `C:\Users\abhay.badhwar\.codex\generated_images\01a0409f-1a16-7bb0-ac5e-caa8b26cef14\exec-c9ca581b-10bc-4a18-83af-cca7c30e1889.png`
- Browser-rendered implementation: `C:\Users\abhay.badhwar\OneDrive - BVGLAZING SYSTEMS\Documents\ChatGPT\Production Tracker Fabrication\test\screens\mobile-next\08-queue-first-rolling-settled.png`
- Same-input comparison: `C:\Users\abhay.badhwar\OneDrive - BVGLAZING SYSTEMS\Documents\ChatGPT\Production Tracker Fabrication\test\screens\mobile-next\09-queue-first-comparison.png`
- Route and state: Rolling / Auto, dark theme, sanitized schedule data loaded, 18 running, 63 open, one blocked line, live order `MU2026-012` and its real waiting queue.
- Requested CSS viewport: 390 x 844 at device scale 1.
- Captured implementation pixels: 375 x 812 at 96 dpi. The in-app browser reserves 15 x 32 pixels from the requested viewport; the content retains the same phone aspect and breakpoint.
- Source pixels: 853 x 1844 at 96 dpi. It was normalized to the implementation frame before judging structure, scale and spacing.

## Full-view comparison evidence

The source and implementation were placed together in one comparison image at equivalent phone scale. The implementation preserves the selected direction's defining hierarchy: a compact machine switcher, thin live-operation strip, one-line queue summary, ordered next-work list, a single immediate Start action and a persistent green Done dock. The production version keeps the proven 96 px global header and real schedule state instead of duplicating identity or using mock content.

## Focused-region comparison evidence

- Machine and live context: the existing global identity controls remain in the production header; the local switcher carries machine identity and setup/print tools without repeating the operator name. The live strip exposes work order, die, quantity, blocked state and details in one scan line.
- Queue rows: numbered sequence, work order, die, project, quantity and due state use the selected flat list pattern. The first waiting row alone receives the Start action, preserving a clear next action while later rows open the existing line inspector.
- Action dock: the green `Mark ... done` control is fixed above the phone safe area, spans the usable width and provides the existing micro-undo feedback after completion.

## Required fidelity surfaces

- Typography: IBM Plex Sans and IBM Plex Mono remain bundled and offline-safe. Work orders and die numbers use the established high-density weights and sizes; secondary project and timing copy is quieter without dropping below the app's mobile legibility baseline.
- Spacing and touch: mobile controls retain the app's 48 px minimum target, while the primary dock is 56 px high. Flat separators replace card stacks, and four real waiting lines remain visible in the verified phone frame.
- Colors: active/live context uses the existing cyan tokens, completion uses semantic green, shortages use red and due-state accents remain distinct. No one-off color system was introduced.
- Assets: the real BV mark and the existing vendored Lucide-compatible icon family are retained. No placeholder art, emoji, handcrafted SVG or CSS illustration was added.
- Responsive behavior: only the machine-page center changes at the 720 px mobile breakpoint. Desktop/monitor queues, inspectors, shift update, bulk tools and all print layouts remain available through the same source model.
- Motion and accessibility: live, summary and row entrance transitions are brief and staggered; pressed controls give immediate feedback; all additions collapse under `prefers-reduced-motion`. Buttons remain semantic and status copy is exposed through the existing live region.

## Comparison history

### Pass 1 — passed

- The first settled production capture matched the selected hierarchy and action model with real data.
- A service-worker reload toast appeared in the initial preview capture; the preview was reloaded and the settled state was captured before comparison. This was a preview lifecycle state, not a layout defect.
- No actionable P0, P1 or P2 visual differences remain.

## Primary interactions and browser health

- Machine tabs switch Auto/Etas and Manual/Iota without leaving the queue-first layout.
- Search/filter expands in place and applies the mobile text and status filters.
- Queue rows open the existing line inspector; its edit, quantity, routing and print capabilities remain intact.
- `Start` promotes the first waiting line to running and exposes the existing Undo action.
- The Done dock completes the current running line and exposes the existing Undo action.
- The visual regression suite verified light/dark phone states, safe-area clearance, queue visibility, edit-dialog access, 200% zoom, reduced motion, monitor mode and contrast. Browser console errors: none.

## Follow-up polish

- [P3] The concept duplicated operator identity in a local row; the implementation keeps identity once in the global header to reduce noise.
- [P3] The concept used a larger isolated Start block. The implementation uses a 68 x 60 px shop-safe target so more of the real queue remains visible.
- [P3] The in-app browser capture includes its native scrollbar; this is outside the application surface.

final result: passed
