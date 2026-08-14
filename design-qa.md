# Option 2 visual QA

## Comparison

- Visual target: `C:\Users\abhay.badhwar\.codex\generated_images\01a001db-b21a-7120-b6c0-c6cc1bbe39eb\exec-0de710d6-3fef-49d1-89c9-ffed7a3bbb1c.png`
- Implementation capture: `test/screens/qa/rolling-desktop-dark.png`
- Combined comparison: `test/artifacts/option2-comparison-final.png`
- Viewport: 1487 × 1058, dark colour scheme, seeded production state, Rolling (Auto), selected overdue rush line
- Responsive check: 390 × 844, queue and full-width selected-line drawer

## Findings and corrections

1. **P1 — none.** The production queue, three-state status control, line selection, filters, navigation, and contextual actions remain operational.
2. **P2 — running strip had too much visual weight.** Replaced the half-width purple fill with a neutral command surface and a narrow work-colour rail.
3. **P2 — machine choice followed the metrics.** Moved the machine tabs ahead of the four metrics to match the selected direction's information hierarchy.
4. **P2 — the command rail lacked centre workload counts and current-shift context.** Added compact live counts for all four centres and restored the shift chip on desktop.
5. **P2 — staging required two decisions for the common case.** Added a large one-tap action for the next shift and kept a secondary picker for exceptions.
6. **P2 — long Shift Update forms had no way to focus the remaining work.** Added an `Only incomplete` filter without hiding saved content by default.
7. **P2 — Setup did not answer whether this device was ready.** Added readiness cards for schedules, sharing, local storage, crew identity, and the latest backup.
8. **P3 — phone detail mode initially preserved the desktop selection during the responsive test.** Verified that a fresh phone session starts on the queue; an explicit line selection opens a full-width drawer with large status targets and a visible close action.
9. **P2 — the approved layout still read as one flat dark slab.** Raised the separation between the command rail, filters, running strip, queue selection and inspector with stronger solid surfaces, coloured edges and restrained elevation.
10. **P2 — generic line marks did not distinguish machines or tools.** Replaced them with a consistent vendored icon subset for Rolling, FOM, CNC/FMC, Punch, Today, Staging and Shift Update, then gave navigation, metrics, overview cards and inspector actions purpose-sized icon tiles.
11. **P2 — brighter mixed surfaces exposed a false failure in the visual contrast test.** Updated its parser for Chromium's `color(srgb …)` serialization; all 26 sampled text pairs now pass WCAG AA in both themes.
12. **P2 — interactions changed state without enough spatial feedback.** Added one-shot motion for page and machine changes, queue selection, status confirmation, group reveal, inspector entry/exit, and Today item completion. Hover lift is limited to precise pointers, and every CSS and Web Animations path honours reduced motion.

## Deliberate differences from the concept

- The existing Cutting wordmark was retained; the concept's invented BV badge was not introduced as a fake brand asset. The icon set was expanded from a consistent Lucide-compatible subset and remains vendored into the single offline file.
- Queue rows keep checkboxes, rush/back-order context, notes, and the large three-state status control because these are working shop-floor actions, not decorative table fields.
- Date and shift context use the app's existing Today and Shift Update semantics; the current shift also appears in the command rail.

## Result

Final result: **passed**. No unresolved P1 or P2 visual issues at the tested desktop and phone states. The complete app, cloud, routing, visual, offline and standalone gates pass; the self-contained build is 3,661 KB.
