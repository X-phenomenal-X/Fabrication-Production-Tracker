# Cutting Tracker — Rolling, FOM, CNC, Multi Punch

A simple tracker for four work centres: **Rolling**, **FOMs**, **CNC**, and
**Multi Punch**. It reads the department's own Rolling and CNC schedule
workbooks — not the company Daily Schedule — and gives each machine a queue of
open lines with a single click-through status.

This is a deliberate reset. An earlier version of this app grew into a large,
Daily-Schedule-driven system (dashboard, order-level material tracking,
history, shift updates, verification against the company schedule). That
scope is still on disk but disconnected from the nav — see "What's hidden,
not deleted" below. This build starts over, smaller, grounded in direct
answers about how the department actually works, with room to expand once
this piece is right.

## Running it

**The easy way — no install, no server.** Download `Cutting-Tracker.html` and
double-click it. It is one self-contained file: put it on the shared drive
and anyone can open it. Use Chrome or Edge.

**For development**, serve the unbundled source (browsers block JavaScript
modules loaded over `file://`, so the split files need a server):

```
npm run serve       # http://localhost:8000
npm run build       # regenerate Cutting-Tracker.html after changing source
```

## First run

1. **Setup** → import the Rolling workbook, then the CNC workbook.
2. Switch to **Tracker** — four sections, in order: Rolling, FOM, CNC, Multi
   Punch.
3. Click a status chip to advance a line: Not started → In Progress → Done.

No Daily Schedule import is needed for the tracker to work — these two
workbooks are the whole source of truth here.

## What a line is

The Rolling and CNC workbooks already split a work order by die — e.g. W/O
30983 has three separate lines (S80.104, S80.105, S80.125G), each with its
own quantity and status. The tracker keeps that granularity: **one row per
work order + die + machine**, not one row per work order. That is how the
sheets already work, and it is the level the department confirmed it thinks
in.

## The four groups

| Group | Machines | Source sheet |
|---|---|---|
| Rolling | Rolling (Auto/Etas), Rolling (Manual/Iota) | Rolling workbook: `Auto`, `Manual` |
| FOM | FOM 1, FOM 2, FOM 3 | CNC workbook: `FOM1`, `FOM2`, `FOM3` |
| CNC | CNC 1 (CNC 2/3/140 exist as machines but currently receive no rows) | CNC workbook: `CNC & FMC` |
| Punch | Multi Punch | CNC workbook: `MultiPunch & SAW` |

Every sheet shares the same shape — `WO# · PROJECT · FL · Product (die) · QTY
· B/O · Cutting Date · Status` — so one parser (`js/import-machines.js`) reads
them all into a flat list of **tasks**. From the sample workbooks: 3,917
tasks, 738 still open.

The four groups are treated as **independent queues** — Rolling finishing a
die does not gate FOM or CNC starting it. That was a direct answer, not an
assumption: the same die numbers appear on both the Rolling sheet and FOM2,
and it was confirmed there is no real hand-off dependency to enforce today.

## Status

Three states, one click cycles through them: **Not started → In Progress →
Done**. This replaces editing the Status cell in the spreadsheet.

A status you set is stored keyed by `machine|wo|die` — deliberately *not* the
row number the sheet happened to put it on. Row numbers shift every time a
new revision is imported; keying on them would silently lose an operator's
update the next time the workbook is reloaded. This is tested directly:
`test/app-check.mjs` sets a status, reloads, then **re-imports the same
workbook** and confirms the status is still there.

A line imported as Back Order or On Hold still buckets as Not started (there
is nothing to click into yet) but keeps a small ⚠ so it does not look
identical to work nobody has looked at.

Done lines are hidden by default (a checkbox reveals them), and each
machine's table caps at 25 open lines, soonest cutting date first, with a
"Show N more" button — Rolling (Auto) alone has 191 open lines, and an
unbounded table is not something anyone can actually scan.

## What's hidden, not deleted

Dashboard, Orders, Materials, Planner, Shift Update, Verify, and Guide are
real, working views from the previous iteration — they still exist in
`js/views/`, still have data behind them, and are not wired into navigation
right now. `js/app.js`'s `TABS` array controls what's visible; adding one
back is a one-line change once that piece is confirmed to fit how the
department actually works.

## Tests

```
npm install                        # once — installs esbuild + playwright
node test/machines-check.mjs       # parses Rolling + CNC, verifies against the Daily Schedule
node test/app-check.mjs            # full walkthrough: import, click a status, reload, re-import
node build.mjs && node test/standalone-check.mjs   # same, against the built single file, opened via file://
```

`test/app-check.mjs` writes screenshots to `test/screens/`.
