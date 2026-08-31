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

---

# Focused Mobile Shift Update Design QA

## Comparison target

- Source visual truth: `C:\Users\abhay.badhwar\.codex\generated_images\01a0409f-1a16-7bb0-ac5e-caa8b26cef14\exec-2684fb58-9d71-475d-8d61-3e2033e11490.png`
- Browser-rendered implementation: `C:\Users\abhay.badhwar\OneDrive - BVGLAZING SYSTEMS\Documents\ChatGPT\Production Tracker Fabrication\test\screens\mobile-shift-next\23-focused-stepper-integrated.png`
- Same-input comparison: `C:\Users\abhay.badhwar\OneDrive - BVGLAZING SYSTEMS\Documents\ChatGPT\Production Tracker Fabrication\test\screens\mobile-shift-next\24-final-reference-vs-integrated.png`
- Route and state: Shift Update / Write, dark theme, sanitized production-volume fixture, Day shift selected, 4 of 13 complete, FOM 2 active, two operators, populated Work done / Next / Notes, suggestions collapsed.
- Requested CSS viewport: 390 x 844 at device scale 1.
- Captured implementation pixels: 375 x 812. The desktop browser reserves 15 x 32 pixels while retaining the same phone breakpoint and aspect.
- Source pixels: 853 x 1844. The source and implementation were both fit without cropping into equal 474 x 760 comparison frames; their nearly identical native aspect ratios prevent stretch or density-driven findings.

## Findings

No actionable P0, P1 or P2 mismatch remains.

The final implementation carries the selected hierarchy rather than merely restyling the desktop form: compact global context, title/date/shift, one completion rail, one active machine, operator count, three handoff fields, progressive-disclosure suggestions, Previous/Next context and one persistent Save & next action. All of those regions are visible in one phone frame.

## Full-view comparison evidence

The source and release capture were placed together in one browser-rendered comparison. Major-region order, proportions and emphasis now align: the completion rail and machine steps stay compact; FOM 2 is the sole editing surface; the editor rows use the source's label-left/control-right rhythm; and Previous/Next sits above the fixed primary dock instead of being obscured by it.

The production screen intentionally retains the app's real global header, shift liveness and identity controls. The source says Aug 29 while the release capture says Aug 30 and reports Off shift because the comparison was captured after the two configured production shifts; this is live operational state, not design drift.

## Focused-region comparison evidence

A separate crop was not necessary because the normalized 1100 x 900 comparison renders each phone at 474 px wide and leaves the active editor typography, stepper, fields, suggestion row, navigation and dock legible. The same comparison was used to inspect the five required fidelity surfaces:

- Typography: bundled IBM Plex Sans/Mono preserve the established product family. Title, machine, field-label, value and dock weights follow the source hierarchy without shrinking body input below 16 px.
- Spacing and layout: phone controls retain the 48 px touch floor. Compact 52 px step cards and label-left handoff rows bring all core controls into one screen; the fixed dock clears the safe area.
- Colors and tokens: the implementation maps the source's dark slate, electric cyan, emerald completion and amber incomplete state to existing semantic tokens. Light and dark automated contrast checks pass WCAG AA.
- Image and icon quality: the real BV mark and existing vendored icon family are preserved. The screen contains no placeholder art, emoji, handcrafted SVG or CSS illustration.
- Copy and content: the source's generic numeric/select examples are replaced by the product's real free-text handoff contract and realistic sanitized work-order copy. This is intentional functional fidelity rather than decorative mock data.

## Comparison history

### Pass 1 — blocked

- [P2] The first coded pass stacked taller text areas, which pushed Notes and Previous/Next below the visible action area and made the editor materially denser than the selected direction.
- [P2] The mobile action button initially dropped onto its own title row because the desktop spacer still occupied a grid cell.
- [P2] Previous and Next were initially nested incorrectly in one button, producing invalid navigation structure.

### Fixes applied

- Repaired Previous/Next as separate semantic buttons.
- Removed the desktop spacer from the phone title grid and aligned the compact action menu beside the title.
- Converted machine handoff fields to the selected label-left/control-right rhythm while preserving 48 px controls and free-text entry.
- Reduced only non-touch vertical spacing, step-card height and editor padding until Notes, suggestions, Previous/Next and Save & next all fit without overlap.
- Added scroll-margin and safe-area spacing so rail navigation and the primary dock never hide active content.

### Pass 2 — passed

- Post-fix implementation: `test\screens\mobile-shift-next\23-focused-stepper-integrated.png`
- Post-fix same-input comparison: `test\screens\mobile-shift-next\24-final-reference-vs-integrated.png`
- All P2 findings are visibly resolved. No P0 or P1 finding was introduced.
- Claude's independent branch was reconciled at component level: operator controls now use the source's minus/plus icons and tracker suggestions disclose at most five items per group before offering `+N more`.

## Primary interactions and browser health

- Step rail changes the active department/machine.
- Operator count increases/decreases and accepts direct numeric input.
- Work done, Next and Notes preserve the existing shift-log data contract.
- Save & next persists partial progress and advances to the next incomplete row.
- Workbook/tracker suggestions expand and insert into the correct field; high-volume machines stay bounded behind a `+N more` disclosure.
- The compact action menu exposes Read/Write, Print update, Print blank form and general shift notes.
- Date and Day/Afternoon controls remain available; desktop and print surfaces remain unchanged.
- Final browser console errors: 0.
- The visual regression suite covers phone safe areas, one visible editor, 13 steps, save/advance, blank printing, light/dark contrast, reduced motion, 200% zoom and non-interactive monitor mode.

## Follow-up polish

- [P3] The source's active FOM row is numbered 5 of 13; production is 7 of 13 because the real handoff includes Back Order, Service Orders and K1285 Pulls before machine rows.

final result: passed

---

# Shop Monitor Department Dashboard Design QA

## Comparison target

- Source visual truth: `C:\Users\abhay.badhwar\.codex\generated_images\01a0409f-1a16-7bb0-ac5e-caa8b26cef14\exec-572dd9ca-6a2f-4be8-a923-b42918e82496.png`
- Browser-rendered implementation: `C:\Users\abhay.badhwar\OneDrive - BVGLAZING SYSTEMS\Documents\ChatGPT\Production Tracker Fabrication\test\screens\monitor-dashboard-2026-08-30\11-monitor-broadcast-final-1440x810.png`
- Same-input comparison: `C:\Users\abhay.badhwar\OneDrive - BVGLAZING SYSTEMS\Documents\ChatGPT\Production Tracker Fabrication\test\screens\monitor-dashboard-2026-08-30\12-option3-vs-implementation.png`
- Route and state: `?monitor#overview`, dark monitor-local palette, sanitized production-volume fixture, Afternoon shift, device-only storage, active work across all four production groups, machine-down / rush / SOP exceptions visible.
- CSS viewport and capture: 1440 x 810 at device scale 1.
- Source pixels: 1440 x 810. Implementation pixels: 1440 x 810. No density or crop normalization was required; the two frames are stacked at native size in the comparison image.

## Findings

No actionable P0, P1 or P2 mismatch remains.

The implementation reproduces the selected broadcast hierarchy: one compact identity/clock/health header, four department pulse numbers, a dominant 2 x 2 NOW field, a three-row NEEDS ATTENTION lane, and a three-handoff NEXT band. It intentionally uses the app's live derived records instead of the concept's sample work orders and counts.

## Full-view comparison evidence

The selected design and implementation were placed together at the same 1440 x 810 size. Major-region proportions, scan order, flat-panel treatment, slate/cyan palette, vertical NOW/NEXT rails, attention color hierarchy and across-aisle type scale align. The implementation stays within one viewport with zero horizontal or vertical overflow and no clipped persistent region.

The production version preserves the existing authentic BV mark and bundled IBM Plex Sans / IBM Plex Mono fonts. It shows real machine names, actual status authors, current shift hours, live storage/sync state and the current date. It does not invent partial-piece completion: because the data model records line state and total quantity but not pieces-complete, each NOW rail is explicitly labelled as machine schedule completion.

## Focused-region comparison evidence

The native-size combined comparison keeps the header, work-order typography, attention symbols, progress rails and next-work details legible, so a separate crop was not required.

- Fonts and typography: IBM Plex remains consistent with the product and closely matches the source's industrial grotesk. Work orders are 46 px at the verified viewport; the clock is 79 px; section labels and KPI values preserve the source hierarchy. Secondary operator and progress captions remain subordinate without replacing the primary work order or blocker.
- Spacing and layout rhythm: the 16:9 frame is filled without scroll, nested-card clutter or unused zones. Four equal NOW areas and three equal exception bands align to shared rails; NEXT remains a single bottom scan line.
- Colors and tokens: dark slate, electric cyan, emerald, amber, crimson and SOP magenta map to the existing semantic meanings. The monitor-local palette is stable even if a shared wall device has the normal app set to light mode.
- Image and icon quality: the authentic reusable BV vector mark is retained. Attention symbols use the product's existing icon system rather than placeholder art, emoji, CSS drawings or newly approximated brand assets.
- Copy and content: the screen answers only what is running, what is next and what needs intervention. Machine-down, rush and SOP deviation copy comes from live model state; no purchasing surface or unrelated operator tool appears.

## Comparison history

### Pass 1 — blocked

- [P2] The first implementation left the NEEDS ATTENTION lane text-only, losing the selected design's strongest rapid-recognition cues.
- [P2] Device-only mode repeated `this device only` and omitted the date from the compact health block.
- [P2] The first captured frame included a transient service-worker reload notice, which was preview chrome rather than dashboard content.

### Fixes applied

- Added large existing-system symbols for machine down, rush and SOP routing deviation, with the same semantic crimson / amber / magenta mapping as the source.
- Rewrote the health detail as `Local storage active · <date>` while keeping the accurate DEVICE ONLY status.
- Settled the service-worker update state and recaptured the same viewport with zero visible controls.

### Pass 2 — passed

- The native-size comparison shows all earlier findings resolved.
- No P0, P1 or P2 mismatch remains. The remaining differences are live-data substitutions and the deliberate schedule-completion label described above.

## Behavior, accessibility and browser health

- Automatic rotation advanced from `2 of 3` to `3 of 3` after 20 seconds and changed the displayed Rolling work order from `32820` to `31782`.
- The monitor overview exposes zero buttons, links, inputs, selects or text areas. Existing machine-specific monitor bookmarks remain non-interactive and unchanged.
- The new visual regression gate asserts four NOW groups, three NEXT handoffs, at most three attention items, a 34 px minimum work-order size, exact 1440 x 810 fit, zero overflow and zero operable controls.
- Main app suite: passed. Visual suite: passed in light/dark themes, reduced motion and both monitor modes.
- Browser console warnings/errors: 0.

## Follow-up polish

- [P3] A future partial-production field could replace schedule completion with `pieces complete / total` without changing the selected layout.

final result: passed

---

# Focused Mobile Engineering Lookup Design QA

## Comparison target

- Source visual truth: `C:\Users\abhay.badhwar\.codex\generated_images\01a0409f-1a16-7bb0-ac5e-caa8b26cef14\exec-f55e1928-5362-4330-9778-e428c54f6e0f.png`
- Final assembly implementation: `C:\Users\abhay.badhwar\OneDrive - BVGLAZING SYSTEMS\Documents\ChatGPT\Production Tracker Fabrication\test\screens\mobile-lookup-audit-2026-08-30\12-final-assembly.png`
- Final profile implementation: `C:\Users\abhay.badhwar\OneDrive - BVGLAZING SYSTEMS\Documents\ChatGPT\Production Tracker Fabrication\test\screens\mobile-lookup-audit-2026-08-30\13-final-profile.png`
- Same-input comparison: `C:\Users\abhay.badhwar\OneDrive - BVGLAZING SYSTEMS\Documents\ChatGPT\Production Tracker Fabrication\test\screens\mobile-lookup-audit-2026-08-30\14-source-vs-final.png`
- Route and state: Engineering Lookup, dark theme, `S80.106` assembly, Components tab, real SA80-106 section drawing, three verified components, fixed print dock.
- Requested CSS viewport: 390 x 844. The connected browser reserved its own chrome and captured 375 x 812 while retaining the intended phone breakpoint and aspect.

## Full-view comparison evidence

The selected Drawing Spotlight concept and final production capture were rendered side by side at equal visual scale. The implementation follows its search-first hierarchy, single-record focus, strong assembly identity, drawing-led center, Components / Used in tabs and persistent print action. It retains the app's proven 96 px global header, real engineering data and existing touch-safe controls.

The intentional difference is the drawing treatment requested after the concept was selected: on a dark phone, the real black-on-white engineering image is inverted and blended into the slate drawing surface. This removes the bright paper rectangle without redrawing or approximating the engineering source. Light theme, enlarged view and print keep the unmodified white sheet.

## Comparison history

### Pass 1 — findings

- [P2] The white paper rectangle around assembly and extrusion drawings looked disconnected from the dark shop-floor surface.
- [P2] Drilling from an assembly component into its extrusion profile could leave the sticky search row over the profile identity after the page retained its previous scroll position.

### Fixes applied

- Added a dark-phone-only `invert` plus `lighten` blend treatment to the real drawing images and matched their container to the existing slate panel token.
- Scoped the blend to focused mobile records. The light theme, enlarged drawing dialog and every print path remain untouched.
- Reset mobile detail handoff to the top of the page when changing records, keeping `Individual extrusion`, profile number and description fully visible below the sticky global header.
- Added automated assertions for dark/light image treatment, focused results, Components / Used in tabs, component drill-in, parent return, safe-area print actions and the profile identity position.

### Pass 2 — passed

- The assembly drawing now reads as linework on the same slate surface as its record while retaining all dimensions and profile labels.
- The `80-113` profile opens with its identity fully visible and the same integrated linework treatment.
- The automated visual suite passes light and dark phone states, all 27 measured WCAG AA contrast pairs, reduced motion, 200% zoom, desktop rails and non-interactive monitor mode. Browser console errors: none.
- No actionable P0, P1 or P2 mismatch remains.

## Follow-up polish

- [P3] The existing global mobile page selector truncates `Engineering Lookup` at narrow browser widths. Its icon and selected-state styling still make the destination clear, and changing the shared header is outside this focused drawing pass.

---

# Mobile Staging and Back Orders Design QA

Same treatment as the Shift Update stepper, applied to the two deepest
remaining phone screens. Both build a phone surface beside the desk one and
let CSS show exactly one; neither desk page changed.

## Depth at 390 x 844, before and after

| Route | Before | After |
| --- | --- | --- |
| Staging | 21.3 screens (17,955 px) | 5.6 screens (4,700 px) |
| Back Orders | 12.1 screens (10,199 px) | 4.9 screens (4,132 px) |
| Shift Update | ~10.6 screens | 1.4 screens |

## Staging

Ninety-seven lines in one flat `Needs staging` group, 184 px per row, with a
native `select` on every one of them. The header already counted 84 overdue
and the queue was already sorted rush-first then by date; the page showed
neither.

- Bucketed into Overdue / Due today / Still to come, each capped at 12 rows
  with the rest one tap away. 84 overdue now reads as 84 overdue.
- `.line-date` is hidden below the small breakpoint, so on a phone the field
  saying how late a line was had never been visible. Rows now carry
  `18 days late` / `due today` / the date, toned accordingly.
- The 97 per-row selects became one picker, built when asked for. Staging for
  the next crew stays a single tap.
- Row height 184 px to 159 px; the height now goes to the work order rather
  than to two full-width controls.

## Back Orders

Seventy-eight lines across seven chase lists.

- [P1] Every row was a `div` with an `onclick` — no keyboard access, no
  accessible name, and invisible to the tap-target pass, which only counts
  real controls. The phone rows are `button`s carrying an `aria-label` that
  says which work order they open.
- [P2] `allBackOrders()` sorts the unowned group **last** (`if (!a.assignee)
  return 1`), while the page's own comment calls an unowned list "the urgent
  one". On a monitor that reads as the odd one out at the end; on a phone it
  put 55 urgent lines eight screens below the fold. The phone list leads with
  it. **The desk ordering was left alone** — flipping it is a product call,
  not a layout one, and is flagged rather than changed silently.
- Each list capped at 8 rows with a `Show N more of M`.
- The cutting date the lists are sorted by is now shown on the row.

## Verification

`npm run test:all` green: rules, machines, app, cloud, routing, visual, build,
site build, size, offline and standalone all `ERRORS: none`.

New regressions in `test/visual-qa.mjs` assert, for both pages: exactly one
surface on screen, the page under 8 screens, buckets present and bounded,
`Show more` reaching the rest, and the date on every row. Staging additionally
asserts zero per-row selects, one-tap staging persisting, and the other-shift
picker; Back Orders additionally asserts every row is a named control, that the
unowned list leads, and that a row still opens the shortage dialog.

## Not done

The reference-mock fidelity pass, for the same reason as the section above:
the mocks are not reachable from this environment.

final result: passed
