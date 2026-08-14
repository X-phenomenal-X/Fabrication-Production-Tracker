# Cutting — BV Glazing Production Tracker

A single place for the Cutting department: the live cut board, the daily planner,
the shift update, and the written process guide.

It does **not** replace the company Daily Schedule. That workbook keeps being
issued as it always was; this app reads it and gives Cutting a working view on
top, plus the tracking the spreadsheet never had.

## Running it

**The easy way — no install, no server.** Download `Cutting-Tracker.html` and
double-click it. It is one self-contained file: put it on the shared drive and
anyone can open it. Use Chrome or Edge.

**For development**, serve the unbundled source (browsers block JavaScript
modules loaded over `file://`, so the split files need a server):

```
npm run serve       # http://localhost:8000
npm run build       # regenerate Cutting-Tracker.html after changing source
```

Rebuild and re-copy `Cutting-Tracker.html` whenever the source changes.

## First run

1. **Add your name** — top right. Every update is stamped with who made it.
2. **Data & Import** → drop in `Daily_Schedule_<date>_Rev_<x>.xlsx`.
   Review what changed, then load it.
3. **Shared file** (optional, Chrome/Edge) — point everyone at one JSON file on
   the shared drive so the department sees the same board.

## The tabs

| Tab | What it is |
|---|---|
| **Dashboard** | One card per work centre, grouped by department — load, progress, blockers |
| **Orders** | Every order, grouped by profile type, with piece counts and history |
| **Materials** | Material status per profile type across the department |
| **Planner** | Assign orders to a day and shift |
| **Shift Update** | Laid out by machine, like the existing Shift Update sheet |
| **Guide** | The department's written process — editable in place |
| **Setup** | Load a revision, machine routing, shared file, backups |

## Work centres

Thirteen, in five departments:

| Department | Machines |
|---|---|
| Rolling | Rolling (Auto/Etas), Rolling (Manual/Iota) |
| FOM | FOM 1 (8900 + screen), FOM 2 (widths), FOM 3 (vents + widths) |
| CNC | CNC 1, CNC 2, CNC 3, CNC 140 |
| Saw | Elumatec Saw #1, Elumatec Saw #2 |
| Punch | Multi Punch |
| Prep | Prep (BD Prep) |

### Machine routing

Each cutting operation is mapped to the work centre that runs it, which is what
makes "what is on FOM 2 today" answerable. Some mappings are certain from the
column names (`SLD ROLLING` → Rolling, `PUNCH` → Multi Punch, `BD Prep` → Prep);
the rest are the app's best guess and are flagged **assumed** until a human
confirms them.

**Edit it in Setup → machine routing.** Edits are stored per-department and
survive re-import. A machine with nothing routed to it says so rather than
showing a zero, so an unconfigured machine never looks like an idle one.

Prep is tracked by status rather than piece count, because `BD Prep` is a status
column — its card shows orders outstanding.

## What it reads from the workbook

| Sheet | Used for |
|---|---|
| `Daily Sched` | Orders, dates, material status, and the cutting columns (27–41) |
| `WIP` | ERP remaining quantities, joined onto each order |
| `PREP Tracker` | Job-level status and project manager |
| `screens sch` | Screens |

The importer cleans up as it reads, and reports everything it did:

- Folds spelling variants together (`I.P` → `IP`, `Repull req` / `Repull Req`)
- Treats `#REF!`, `#VALUE!` and `#N/A` cells as blank
- Drops phantom dates such as `1899-12-16`
- Reads banner rows (`IN CUTTING`, `MAT'L REQUIRED`, `WINDOW WALL`) as section
  headings, and ignores repeated header rows and separators
- Keeps non-numeric work orders — `MU2026-012`, `DAN 509`, `29038so`,
  `PARCEL29-SWD` are all real orders
- **Rejects date serials sitting in quantity columns.** A date typed into a
  piece-count cell arrives as a number around 40000–60000 and would otherwise
  destroy every total. These are listed in the import report so they can be
  fixed at source.

## Profile types

An order is not one lump of aluminium. It is widths, heights, vents and louvers,
and each can be pulled, on order or short independently. The Daily Schedule
carries a single `purch` status for the whole order, which is why "the order says
Pulled but we are still waiting on vents" was invisible.

| Profile | Operations |
|---|---|
| Widths | `WIDTHS` |
| Heights | `HTS` |
| Vents | `VENT` |
| Louvers | `LVRS/TC PAN` |
| Service Orders | added by hand |
| Hinges | automatic on 8560 jobs |
| Extra Operations | `PUNCH`, `VYNL.S`, `SP.S`, `WW CNC`, `SLD ROLLING`, `SLD CUTTING`, `ADAPTORS CNC` |

Each profile carries its own material state: Pulled, Stock OK, Part short, At
paint, On order, Extrusion due, Short, TBD, Not required. Where nothing has been
recorded the app seeds it from the order's `purch` column and marks it
**from schedule**, so a real entry is always distinguishable from an inherited one.

### Hinges and the 8560 rule

8560 vents need hinges, but the vent system is not in the Daily Schedule — it is
in the `Product` sheet of the CNC schedule, per job. That mapping is seeded in
`js/products.js`, so the Hinges profile appears automatically on jobs running
8560 or 8560 HT (currently jobs 1093, 1107, 1124 and 1131). Those rows are
marked **8560** on the order so it is clear why they are there.

### Orders added by hand

Service orders and anything else off-schedule are added with **+ Add order** on
the Orders tab. They are stored separately from imported rows, so re-importing a
revision never removes them, and they are marked **by hand** on the board.

## Traceability

Every change is recorded against the order — what changed, from what to what, by
whom, and when. Each order shows its own history, and it updates live as work is
logged. The record is append-only and merges across the shared file by id, so no
one's entries are lost when two people work at once.

Order completion is the headline on every order: percent complete, pieces done
against pieces required, and how many profiles are finished.

## What the app owns

The spreadsheet records the *target* — 80 pieces of `WIDTHS`. Nothing in it ever
recorded how many were actually cut. That is what lives here:

- Piece counts per operation, per order, stamped with who and when
- Material status per profile type
- The full change history per order
- Shift updates by machine
- Day/shift plans
- The process guide

Re-importing a new revision replaces the schedule and keeps all of the above.

## Sharing

Each person connects once to the same JSON file (Chrome/Edge, File System Access
API). Saves merge **record by record** — two people editing different orders both
keep their work; only the same field edited twice resolves to the most recent.

Without a shared file the app still works fully, storing data in that browser.
`Export everything` / `Import a backup` moves data between machines.

## Tests

```
npm install playwright        # once
node test/import-check.mjs    # parse the workbook, print counts and rejects
node test/app-check.mjs       # full walkthrough in Chromium, fails on any console error
```

`test/app-check.mjs` writes screenshots to `test/screens/`.

Both accept a workbook path as the first argument, defaulting to the sample used
during development.

## Known gaps

- Machine list, operator counts and targets in `js/machines.js` are seeded from
  the Shift Assignment and TARGETS sheets (week of Aug 12). They are not yet
  editable in the UI.
- The Rolling and CNC workbooks are not imported yet — only the Daily Schedule.
  Setup/die data from `ROLLING SET UP CHART` is summarised in the guide by hand.
- Guide sections marked **TODO for the department** need a human to confirm.
