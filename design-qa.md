# Kinetic Command Stack — Design QA

## Comparison target

- Source visual truth: `C:\Users\abhay.badhwar\.codex\generated_images\01a0409f-1a16-7bb0-ac5e-caa8b26cef14\exec-b53c81b0-ebb0-4db0-9fb5-69ab61561b73.png`
- Local source copy: `qa/kinetic-dashboard-reference.png`
- Final browser-rendered implementation: `qa/kinetic-dashboard-desktop-final.png`
- Full source/implementation comparison: `qa/kinetic-dashboard-comparison-final.png`
- Focused title, KPI, and Running Now comparison: `qa/kinetic-dashboard-focused-final.png`
- Responsive evidence: `qa/kinetic-dashboard-mobile.png`

## Normalization

- Viewport: 1440×1024 CSS px.
- Source pixels: 1440×1024.
- Implementation pixels: 1440×1024.
- Device scale factor: 1.
- No density resampling was required.
- State: dark theme, Overview / Kinetic Command Stack, real locally loaded
  production data, device-only sync. Dynamic values intentionally differ from
  the generated reference data.

## Final findings

No actionable P0, P1, or P2 findings remain.

### Fonts and typography

The implementation preserves the reference's condensed industrial hierarchy
through weight, tracking, case, and scale while using the app's bundled IBM
Plex Sans and IBM Plex Mono. This is an intentional offline/PWA constraint and
keeps work-order numerals sharper than a network font dependency. Date, KPI,
machine, status, work-order, and metadata levels remain visibly distinct.

### Spacing and layout rhythm

The final browser capture matches the reference's major proportions: 232px
navigation rail, compact title/handoff row, five-cell health rail, wide Running
Now hero, grouped next/attention rows, and bottom shift rail. The implementation
deliberately shows fewer attention rows than the reference because the user
asked for an overview rather than another full queue. The underlying machine
pages retain the dense schedule.

### Colors and tokens

Dark slate, cyan running state, emerald completion, amber date warning,
crimson shortage, rose Rush, and magenta SOP conflict are implemented as
separate semantic tokens. Automated contrast checks report all 25 sampled text
pairs passing WCAG AA in light and dark modes.

### Image quality and asset fidelity

The authentic BV Glazing logo and the existing production icon library are
used. No emoji, placeholder art, hand-built SVG illustration, or CSS substitute
replaces a target asset. Engineering lookup keeps the real master drawing and
adds pan/pinch controls without rasterizing or redrawing it.

### Copy and content

Labels use floor language: Running now, On Rolling (Auto), Done, Mark complete,
Coming next, Keep an eye on, Blocked, Sync, and Shift update. Live values come
from the loaded workbooks and local operational state rather than mock text.

## Comparison history

### Pass 1 — blocked

Evidence: `qa/kinetic-dashboard-desktop-pass1.png`.

- P1 — The handoff occupied a 233px-tall dashboard card; the reference uses a
  compact horizontal handoff. Fixed by rebuilding it as a two-row 72px panel
  with a separated action.
- P1 — Running Now ended with Open W/O rather than the reference's dominant
  green Done macro. Fixed with a 385×98px one-tap Done control, immediate commit,
  radial confirmation, ghost departure, FLIP reflow, and Undo.
- P2 — The health rail had four signals and no sync state. Fixed with a fifth
  live Sync / Local / Offline / Error signal.
- P2 — A large Quick Starts column compressed the production decision surface.
  Fixed by returning desktop navigation to the established sidebar and giving
  the main command stack the full content width.
- P2 — The reference's current-shift rail was missing. Fixed with a real
  current Shift Update status and action.

### Pass 2 — blocked

Evidence: `qa/kinetic-dashboard-comparison-pass2.png`.

- P1 behavior — Two fast route changes could leave an old page under a new
  active navigation item while a View Transition was settling. Fixed by
  shortening the active transition and rendering the newest navigation
  immediately; rapid-navigation automation now passes.
- P1 responsive — Glass backdrop filtering on the Engineering panel created a
  containing block for its fixed phone action dock, placing Print sheet below
  the safe area. Fixed by removing backdrop filtering from that mobile parent;
  the fixed action again clears the safe area.
- P2 polish — The phone KPI rail exposed a native horizontal scrollbar. Fixed
  by preserving touch scrolling while hiding the scrollbar.

### Pass 3 — passed

Evidence: `qa/kinetic-dashboard-comparison-final.png` and
`qa/kinetic-dashboard-focused-final.png`.

- Earlier P0/P1/P2 findings are resolved.
- The final browser capture has no horizontal overflow and no console errors.
- The five required fidelity surfaces were reviewed in the combined comparison.

## Primary interactions tested

- Done commits immediately, shows radial/ghost feedback, and restores through
  the micro-Undo action.
- Queue survivors reflow by stable motion key.
- Rapid Rolling → Jobs navigation lands on Jobs with matching URL, heading,
  and active navigation.
- Phone right swipe crosses the 88px threshold and stores Done.
- Phone rows expose real labelled Done and Note actions.
- Engineering drawing opens from its source control; 44px Zoom out, Reset, and
  Zoom in controls share the 1×–5× pan/pinch transform.
- Reduced motion disables sampled transitions and animations.
- Monitor overview remains readable and has zero operable controls.

## Automated evidence

`test/visual-qa.mjs` passed across light/dark themes and phone, tablet,
workstation, monitor, and desktop widths. It also passed WCAG token contrast,
44px phone targets, safe-area docks, reduced motion, monitor read-only behavior,
completion/Undo, rapid navigation, swipe-to-Done, and drawing zoom.

## Residual P3 polish

- The generated reference uses a decorative circular schedule ring and sync
  waveform. The implementation keeps the existing icon system and numeric
  readouts to avoid nonfunctional decoration on an operational surface.
- The reference labels the destination “Command Stack”; the production app
  retains “Overview” in navigation because that is the established cross-device
  route name. The in-page kicker carries “Kinetic command stack.”

## Implementation checklist

- [x] Reference and final browser capture compared at equal dimensions.
- [x] Desktop command hierarchy matches the selected direction.
- [x] Phone hierarchy, fixed actions, and touch sizes verified.
- [x] Completion, failure, sync, navigation, swipe, and drawing motion defined.
- [x] Reduced-motion and keyboard/accessibility behavior preserved.
- [x] Console errors checked: none.
- [x] Visual automation: passed.

## 1 Sep 2026 — mobile Done-action contrast regression

### Comparison target and normalization

- Source visual truth: `C:\Users\abhay.badhwar\.codex\codex-remote-attachments\01a0409f-1a16-7bb0-ac5e-caa8b26cef14\5399620B-1095-4CC3-B852-A942FF30AB4D\1-Photo-1.jpg`.
- The source was not copied into the public repository because its work order
  and project are production-identifying data.
- Browser-rendered implementation: `qa/done-action-mobile-light.png`.
- Privacy-safe focused comparison: `qa/done-action-focus-comparison.png`.
- A combined full-view comparison was opened and inspected in the browser but
  was not retained because it reproduces the production-identifying source.
- Source pixels: 590×1280; supplied iPhone screenshot, approximately 390×844
  CSS px at 1.51× density, including 82 source pixels of device chrome.
- Implementation pixels: 375×812 from an Edge content viewport under a
  temporary 390×844 browser override.
- Normalization: both app surfaces were displayed at 375 px wide; the source's
  device-chrome region was cropped before the full-view comparison. The
  focused action crops were aligned independently to avoid content and density
  differences elsewhere on the dashboard.
- State: light theme, Overview, Running Now line in progress. Production and
  sanitized work-order values differ intentionally; the component state,
  breakpoint, hierarchy and action copy are the comparison targets.

### Findings and comparison history

#### Pass 1 — blocked

- P1 — The `DONE` label used green ink over a green gradient. The pale left
  stop reduced foreground/background separation until the label visually
  merged into the button. `Mark complete` used a different dark ink, so the
  action also lacked one coherent filled-control treatment.
- Fix — `.overview-done` now uses the semantic `--ok` fill with `--on-fill`
  ink. The check medallion reverses those same tokens. Both label lines inherit
  the high-contrast foreground, and the decorative wash uses only
  `--on-fill-soft` behind a raised content layer.

#### Pass 2 — passed

- The combined comparison shows the corrected action as one solid completion
  control with a clearly legible `DONE`, secondary label and check medallion.
- Measured light-theme label and medallion contrast: 5.45:1.
- Measured dark-theme label and medallion contrast: 9.87:1.
- Done committed, exposed the Undo action, and restored the running line.
- Browser console errors/warnings: none.

### Required fidelity surfaces

- Fonts and typography: bundled IBM Plex weights, casing, sizes and label
  hierarchy are unchanged; the fix changes only semantic foreground tokens.
- Spacing and layout rhythm: the reported width, height, medallion alignment,
  section rail and surrounding card spacing are unchanged.
- Colors and visual tokens: the mixed green gradient was replaced by the
  existing semantic filled-surface pairing, preserving completion green while
  clearing WCAG AA in both themes.
- Image quality and assets: no image or icon asset changed; the existing check
  icon remains crisp and now sits on an inverse token fill.
- Copy and content: `DONE` and `Mark complete` are unchanged.

### Implementation checklist

- [x] Reported phone screenshot opened and inspected.
- [x] Corrected phone implementation captured in light and dark themes.
- [x] Full view and focused action compared in one combined visual.
- [x] Label and medallion contrast measured in both themes.
- [x] Done and micro-Undo interaction verified.
- [x] Console checked: no errors or warnings.

final result: passed
