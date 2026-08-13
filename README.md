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
| **Today** | Current shift, the cut queue in urgency order, what is blocked, last handover |
| **Board** | Every order, filterable, with per-operation piece counts |
| **Planner** | Assign orders to a day and shift |
| **Shift Log** | The shift update, laid out by machine like the existing sheet |
| **Guide** | The department's written process — editable in place |
| **Data & Import** | Load a revision, manage the shared file, export a backup |

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

## What the app owns

The spreadsheet records the *target* — 80 pieces of `WIDTHS`. Nothing in it ever
recorded how many were actually cut. That is what lives here:

- Piece counts per operation, per order, stamped with who and when
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
