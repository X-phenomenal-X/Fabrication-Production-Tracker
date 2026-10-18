# Shift machine target plans

In Shift Update, choose a machine and use **Add target plan**. Enter the approved hourly standard and available minutes after breaks, then non-overlapping planned setup and (for Elumatec) bandsaw allowances. Apply to the draft and save the handover. All numeric standards start unset; the app does not recommend a production rate without measured baseline data and supervisor agreement.

Multi Punch counts **windows**. Other machines count **pieces**. Actual good output is entered manually; imported schedule quantities and completed lines are never converted or reused as output. For Elumatec, count cutting output only; bandsaw is a time allowance, not a second output stream.

Target = floor(hourly standard × (available minutes − planned setup − planned bandsaw) / 60). Attainment = good output / target × 100. Blank actual means unmeasured; zero means measured zero. Zero target has no percentage. Above-target output is not capped at 100%. This is a shift plan comparison, not OEE or quality yield. Actual downtime does not reduce the plan, and rejects or duplicate rework must not be counted as good output.

Plans are optional snapshots on each machine's existing shift-log row. Saved read views, copied handover text and printed reports include the unit, inputs, target and actual. Existing backup/sync handles the row. Editing a saved handover remains possible and requires renewed acknowledgement. No global default can retrospectively change a saved plan. Mobile draft edits are detached from saved records.

These plans are entered per shift; no historical trend or dashboard aggregate combines windows and pieces. Further automation needs agreed standards and a reliable source of accepted output. Existing tests are preserved; new calculation/persistence and mobile/desktop browser checks are added to CI.

The full regression run also exposed a delayed autofocus race in the employee editor: typing a department could append to the employee name. Initial focus is now set synchronously after opening the dialog, before the user can move to another field. The existing employee-edit regression covers this flow.
