# Production readiness

This checklist separates safeguards the repository can enforce from the few
deployment actions that require the tracker owner. A release is ready only when
both sections are complete.

## Enforced by the repository

- `npm test` is the single release gate. It covers importer rules, a generated
  sanitized workbook, all app views, two-device cloud convergence, routing,
  responsive visual checks, the modular hosted/offline build and the standalone
  `file://` rollback.
- GitHub Pages runs that gate before publishing. A failing test prevents the
  deploy job from receiving the built site.
- Dependencies are pinned in `package-lock.json`; CI uses `npm ci`.
- Test workbooks are generated from fictional data. Production workbooks and
  Supabase credentials are never needed by CI and must not enter the repo.
- Local-storage failures stay visible as a persistent error banner. Operators
  are told not to close the page and to export a backup after storage recovers.
- Sync merges each record by a logical revision instead of trusting device
  clocks. Deletion markers are retained so an offline device cannot restore a
  deleted record months later.

## Validate with the real workbooks before a release

Set both paths, then run the same release gate:

```powershell
$env:BV_ROLLING_WORKBOOK = 'C:\path\Rolling_Schedule_2026.xlsx'
$env:BV_CNC_WORKBOOK = 'C:\path\CNC_Schedule_Rev_E.xlsx'
npm test
```

Confirm the import report against the current production files. The handoff
baseline is 3,917 tasks and 738 open, including 67 open back orders and 202
dies. These counts are a drift alarm, not a forever contract: investigate a
difference rather than changing a test to make it green.

The report must also confirm:

- Shift data came only from the exact `Shift Update` tab in the CNC schedule.
- Seven machine names resolved from the live tab; FMC 1 and FMC 2 remained
  without an update, and archived shift tabs did not contribute data.
- `CNC-3` resolves to the configured CNC 1 machine.
- Alphanumeric work orders such as `MU2026-012`, `DAN 509`, `29038so`,
  `PARCEL29-SWD`, `TRIMS` and `PREP` survive import.
- `B/O` text stays contextual bar text, `IP BO` also raises the back-order flag,
  and date serials do not become quantities.

## Owner actions before live use

- Replace the legacy Supabase anon key that appeared in the setup transcript
  with a publishable key. Verify the old key fails, then enter the replacement
  on every approved device. Never use a secret or service_role key in the app.
- Import both live workbooks on one synced device. On a second device, confirm
  the base task count, latest import names, shift-update date/shift and a test
  work-status change all converge.
- Enable branch protection for
  `claude/dept-operations-dashboard-v9un45` and require the Pages workflow to
  pass before changes can reach the default branch.
- Keep a dated copy of the previous standalone `Cutting-Tracker.html` as the
  rollback artifact for each release.

## Operating routine

| Frequency | Owner | Check |
|---|---|---|
| Each import | Schedule owner | Read the import report; resolve every warning before relying on the board. |
| Weekly | Shift lead | Export a JSON backup and store it beside the schedule files. |
| Monthly | Tracker owner | Restore the newest backup on a non-production browser profile and verify task notes, statuses, assignments and deletions. |
| Each release | Tracker owner | Run `npm test` with real workbook paths, keep the rollback HTML, then publish. |
| After credential or device changes | Tracker owner | Remove obsolete device configuration and repeat two-device convergence checks. |

The Supabase table intentionally has no user accounts. Anyone with the project
URL and publishable (or legacy anon) key can read and write the site data;
configuration control and regular backups are therefore operational
requirements, not optional polish.
