# Mobile Overview Design QA

## Comparison target

- Source visual truth: `C:\Users\abhay.badhwar\.codex\generated_images\01a0409f-1a16-7bb0-ac5e-caa8b26cef14\exec-77d499e7-60c8-4477-b292-3e443680afd1.png`
- Browser-rendered implementation: `C:\Users\abhay.badhwar\OneDrive - BVGLAZING SYSTEMS\Documents\ChatGPT\Production Tracker Fabrication\test\screens\mobile-next\05-command-rail-mobile-final.png`
- Route and state: Mobile Overview, dark theme, sanitized schedule data loaded, off-shift state, empty previous-shift handoff, one urgent back-order line.
- Requested CSS viewport: 390 x 844 at device scale 1.
- Captured implementation pixels: 375 x 812 at 96 dpi. The in-app browser reserves 15 x 32 pixels from the requested viewport; the app content retains the same 0.462 aspect ratio.
- Source pixels: 853 x 1844 at 96 dpi. The source was normalized by aspect and scale to the implementation frame (375 x 811) before judging spacing and hierarchy; no findings were filed from the density difference alone.

## Full-view comparison evidence

The source and implementation were opened together at original resolution. The implementation preserves the source's defining structure: compact two-row header, shift summary, green completion rail, compact handoff, cyan numbered command rail, dominant urgent work action, a single coming-next lane, and a red risk lane. It deliberately fits all three priorities in one physical phone viewport because the product requirement is a ten-second overview rather than a poster-scale mock.

## Focused-region comparison evidence

- Header and shift summary: the existing 96 px production header was preserved, with real shift/offline/sync state and the existing BV mark. The selected concept's hierarchy is present without copying its oversized static header.
- Urgent work region: work order, die, shortage, project, quantity, due date, warning icon and primary action all align to the selected concept. The work-order size was increased after the first comparison.
- Command rail and supporting lanes: numbered nodes, continuous cyan rail, separators, compact next row and red risk treatment match the concept while using the app's existing icon family and live data.

## Required fidelity surfaces

- Fonts and typography: IBM Plex Sans and IBM Plex Mono remain bundled and render offline. The urgent work order now uses a 19–24 px responsive display treatment with tighter tracking; supporting text remains at the established 13.5–15 px scale. No clipping or broken wrapping was observed.
- Spacing and layout rhythm: card boxes were removed on mobile in favor of the source's continuous rail and separators. The 96 px app header, 48 px minimum touch target and 56 px primary action are preserved. The source's oversized date block was intentionally compacted so all three priorities remain above the fold.
- Colors and visual tokens: completion uses semantic green, active navigation and the rail use cyan/blue, and shortage/risk use red. All colors come from the existing light/dark token system; no one-off palette was introduced.
- Image and asset fidelity: the production BV mark is retained. There are no raster illustrations in this screen. Icons use the app's existing vendored, Lucide-compatible offline icon set; no placeholder, emoji, CSS illustration or new hand-built icon was introduced.
- Copy and content: labels match the selected concept, while dates, shift state, counts, handoff source and work-order details remain live rather than being hard-coded to the mock.
- Accessibility and motion: controls remain at least 48 px on mobile, semantic buttons and the progressbar label are retained, contrast continues to use the tested theme tokens, and the staggered entrance/pressed transitions collapse under `prefers-reduced-motion`.

## Comparison history

### Pass 1 — blocked

- [P2] Urgent work-order hierarchy was too weak.
  - Evidence: source used the work order as the dominant line in the urgent region; implementation capture `04-command-rail-mobile-overview-clean.png` rendered it at the ordinary queue size.
  - Impact: the primary floor action did not scan quickly enough and repeated the typography weakness the redesign was meant to fix.
  - Fix: added a responsive 19–24 px size, 1.0 line height, tighter tracking and safe wrapping to `.overview-task-id > strong`.

### Pass 2 — passed

- Post-fix evidence: `05-command-rail-mobile-final.png`.
- The work order is now the dominant item within the urgent region without forcing quantity, badges or the 56 px action out of the viewport.
- No actionable P0, P1 or P2 differences remain.

## Primary interactions and browser health

- `Open W/O 71024` opened the correct Rolling queue and focused the exact line.
- The mobile page chooser opened from Rolling and returned to Overview.
- Browser console errors checked after both interactions: none.

## Follow-up polish

- [P3] The source mock uses a bespoke handoff/person symbol; the implementation uses the closest semantic icon already present in the offline app's icon subset.
- [P3] The source gives the calendar date more vertical space. The implementation intentionally keeps the compact date treatment to preserve the user-requested overview density.

# Mobile Shift Update Design QA

## What changed

The Shift Update writer stacked thirteen machine cards in one column at every
width. On a phone that is roughly nine thousand pixels of scrolling to reach
the two rows nobody has filled in. At 720 px and below the writer is now a
stepper: a completion rail across all thirteen rows, one editor open at a time,
and a fixed dock that saves what is written and moves to the next row nobody
has done. The desktop writer and every print layout are untouched — both
surfaces render and CSS shows exactly one, and they share a single draft, so an
update started on a phone is finished on a monitor.

## Comparison target

- Reference mock: **not available in this environment.** The selected concept
  image named in the continuation brief lives on the user's Windows machine
  (`...\.codex\generated_images\...`), which this session cannot reach. No
  source-versus-implementation fidelity pass was run, and none is claimed here.
  What follows is measured behaviour and rendered output only.
- Route and state: Shift Update, write mode, sanitized fixture loaded,
  Afternoon shift, nothing yet saved.
- Viewport: 390 x 844 at device scale 1, light and dark.
- Rendered implementation: `test/screens/qa/shift-stepper-{light,dark}.png`,
  plus the walked flow in `test/screens/mobile-shift-next/`
  (`01-open`, `02-machine`, `03-suggestions`, `04-after-save`, `05-bottom`,
  `06-menu`, `07-toast`). `test/screens/` is gitignored, so these are local
  artifacts of this run rather than committed evidence.

## Measured evidence

- Rail walks all 13 reportable rows; exactly 1 editor is open; the desktop
  writer is `display: none` and never renders beside it.
- Selecting step 9 brings that step fully inside the rail. The rail is rebuilt
  on every render, so its position is carried and the active step re-centred —
  the same fault that once hid the current page from the nav.
- Save & next persisted `rows.backorder.done` to `localStorage` and advanced to
  Rolling (Auto); the completed step is marked, and the count moved to 1.
- Suggestions are folded on arrival. A machine offering 87 lines renders 5 per
  block behind a `+77 more` chip rather than 87 chips; opening them no longer
  pushes the three boxes off the bottom of the screen (page height 6518 px
  before the cap, 2136 px after).
- Dock: clears the last element on the page (0 px of overlap), sits fully above
  the fold with `env(safe-area-inset-bottom)` respected, and its Save control
  measures 56 px. The save toast, which lands in the same corner, was lifted
  clear of it.
- Header stays within the 96 px budget. The date and shift pills were put on
  one row; before that, `Afternoon` was clipped by 21 px.
- Every control on the screen measures at least 44 px; no horizontal overflow
  at 390 px; 0 browser console errors across the walked flow in both themes.
- Contrast: 14 measured text pairs pass WCAG AA in each theme, including the
  active step chip, the completed step chip, the written count, the suggestion
  count and the actions menu.
- Nothing the header carried on a monitor was dropped. Read/Write, Print
  update, Print blank form and general shift notes are all in the actions
  menu, and printing the blank form from the phone menu was exercised
  end to end.

## Findings

### Pass 1 — blocked

- [P1] `button.primary` painted `#fff` on `--accent`, which measures **2.77:1**
  against the dark palette's brand blue — under AA, on the one control most
  screens need found first, including this screen's Save & next dock.
  - Fix: introduced `--on-accent` (white in light, `#07111d` in dark) and
    pointed `button.primary` at it. Light mode resolves to `#fff` and is
    unchanged; only dark mode moves. `button.primary` and `.su-m-save` were
    added to the measured contrast pairs so this cannot come back.
  - Note: this was a pre-existing app-wide defect surfaced by the new
    regression, not introduced by the stepper.
- [P2] The active step chip had the same white-on-accent pairing (2.77:1).
  - Fix: same token, and the step's number badge now scrims `currentColor`
    so it follows the label's colour in both themes.
- [P2] Opening suggestions dropped all 87 offered lines onto the screen.
  - Fix: `suggestions()` takes an optional per-block `limit` used only by the
    phone, with the remainder one tap away. Desktop is unchanged.
- [P2] The rail came back at scroll zero on every render, so a step past the
  fourth was selected but off-screen with nothing saying so.
  - Fix: carry the rail's scroll position across rebuilds and centre the
    active step when it changes.
- [P3] The save toast covered the Save & next dock.
- [P3] The `#Ops` decrement used the `x` (close) glyph; a `minus` icon was
  added to the offline icon set.
- [P3] The breaks row in the actions menu was a disabled button, which reads
  as something that could be pressed later; it is now a plain fact row.

### Pass 2 — passed

- `npm run test:all` green: rules, machines, app, cloud, routing, visual,
  build, site build, size, offline and standalone all report `ERRORS: none`.
- Build 28.1 MB of the 32.0 MB budget; initial HTML 1.3 KB; first load
  890.3 KB of 1100.0 KB; heavy modules stayed behind their lazy boundaries.
- Reduced motion still disables every sampled transition and animation,
  including the stepper's entrance and the dock.
- Monitor mode still exposes 0 pressable controls.
- No actionable P0, P1 or P2 differences remain.

## Known limitation

`Only incomplete`, the desktop filter that hides written rows, has no phone
equivalent. The stepper supersedes it: the rail marks what is written, and
Save & next skips to the next row nobody has done. Recorded here rather than
left to be rediscovered.

final result: passed
