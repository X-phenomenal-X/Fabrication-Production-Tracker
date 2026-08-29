# Design QA — mobile application header

## Comparison target

- Source visual truth: `test/screens/mobile-audit/00-user-reference.jpg`
- Rendered implementation: `test/screens/mobile-audit/08-header-final.png`
- Combined comparison input: `test/screens/mobile-audit/09-header-comparison.png`
- State: Overview, dark shop-floor header, phone portrait. The source contains production data and iOS browser chrome; the implementation uses the sanitized local fixture. The comparison is therefore scoped to the app-owned header and the shift summary immediately below it.
- Responsive viewport requested: 390 × 844 CSS px at device scale 1. The in-app browser capture raster is 375 × 812 px after its own chrome; the measured app header is 375 × 96 CSS px.
- Source pixels: 590 × 1280. The attachment has unknown capture density and was scaled to 375 px wide in the combined comparison rather than treated as a 1:1 density reference.
- Implementation pixels: 375 × 812.

## Findings

No actionable P0, P1 or P2 findings remain.

- The former horizontal page rail exposed a clipped next tab, squeezed the operator picker, and made the two global tools read as overflow. The implementation replaces it at phone width with one 44 px current-page control and a complete twelve-destination navigation sheet.
- The visible Overview shift range previously rendered `undefined:00–undefined:00` locally and showed an obsolete 15:00–23:00 range in the production reference. It now reads the shared two-shift definition and renders `15:30–00:00` for Afternoon and `07:00–15:30` for Day.
- The header remains exactly 96 px tall, has zero document-level horizontal overflow, and every visible button/select measures at least 44 × 44 px.

## Required fidelity surfaces

- Fonts and typography: the existing locally packaged IBM Plex hierarchy is preserved. Current page, shift, sync and operator labels retain their prior weights and sizes; the active page label truncates safely only below its available width.
- Spacing and layout rhythm: the header remains a two-row, 96 px shell. Row one is operational identity and health; row two is page, operator and global tools. The prior half-visible tab is gone and the navigation sheet uses an even two-column grid.
- Colors and visual tokens: the company navy, semantic page tones, sync state and focus ring all reuse existing tokens. No new palette was introduced.
- Image quality and asset fidelity: the existing official three-shape BV mark is unchanged. Navigation uses the app's existing packaged icon set; no logo approximation or placeholder asset was added.
- Copy and content: current-page copy is explicit, all twelve destination names remain available, and the active shift uses the confirmed two-shift schedule.

## Focused comparison evidence

The combined comparison shows the complete before and after phone screens together. A separate crop was unnecessary because the header labels and edge clipping are legible at the displayed 375 px width. The production data below the header was not evaluated for visual fidelity because it differs from the sanitized fixture by design.

## Interaction and runtime checks

- Opened and closed the phone navigation sheet.
- Confirmed all twelve destinations render.
- Navigated from Overview to Rolling through the sheet; the sheet closes and the current-page control updates.
- Confirmed Engineering Lookup and Setup remain visible 44 px actions.
- Checked browser console warnings/errors: none.
- Automated visual QA passed light/dark themes, contrast, 390 px phone layout, reduced motion and monitor mode.
- End-to-end application check passed after the change.

## Comparison history

1. Initial evidence: the source and local before-capture showed a clipped horizontal page rail, a crowded operator/tool cluster and an invalid Overview shift range.
2. Fix: replaced the phone-only rail with a current-page trigger and animated bottom navigation sheet; retained desktop navigation; corrected Overview to use `shift.range` and the Day/Afternoon handoff sequence.
3. Post-fix evidence: `08-header-final.png` and `09-header-comparison.png` show a fully visible, stable two-row header. Rendered measurements and interaction checks passed.

## Follow-up polish

- P3: confirm the 96 px header under the exact production phone's installed-PWA safe-area behavior after deployment. The browser and automated breakpoint checks are already green.

final result: passed
