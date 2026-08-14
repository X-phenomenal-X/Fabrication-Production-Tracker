# Cutting Tracker — Rolling, FOM, CNC, Multi Punch

A page per work centre, driven entirely by the department's own Rolling and CNC
schedule workbooks. Each page shows that machine's open lines grouped by
cutting date, with a single click to move a line through Not started →
In Progress → Done.

Nothing else is in here. No Daily Schedule, no order-level material tracking,
no dashboards — that scope was removed deliberately so this piece can be got
right first.

## Running it

**The easy way — no install, no server.** Download `Cutting-Tracker.html` and
double-click it. One self-contained file: put it on the shared drive and
anyone can open it. Use Chrome or Edge.

**For development**, serve the unbundled source (browsers block JavaScript
modules loaded over `file://`):

```
npm run serve       # http://localhost:8000
npm run build       # regenerate Cutting-Tracker.html after changing source
```

## First run

1. **Setup** → import the Rolling workbook, then the CNC workbook.
2. Pick your centre from the nav: **Rolling · FOM · CNC · Multi Punch**.
3. Pick your machine from the sub-tabs, and work the queue.

## The pages

| Page | Machines | From |
|---|---|---|
| Rolling | Rolling (Auto/Etas), Rolling (Manual/Iota) | Rolling workbook: `Auto`, `Manual` |
| FOM | FOM 1, FOM 2, FOM 3 | CNC workbook: `FOM1`, `FOM2`, `FOM3` |
| CNC | CNC 1, CNC 2, CNC 3, CNC 140 | CNC workbook: `CNC & FMC` |
| Multi Punch | Multi Punch | CNC workbook: `MultiPunch & SAW` |

Machines with no lines scheduled still appear — a machine that is idle should
look different from one that does not exist.

## A line

One row per **work order + die + machine**, matching how the sheets already
split a work order. W/O 30983 with three dies is three lines, each with its
own quantity and its own status.

Lines are grouped by cutting date, urgent first:

**Overdue · Today · This week · Later · No date**

The first three start expanded, the last two collapsed. Every group caps at 25
rows with a "Show N more" — on the sample data Rolling (Auto) alone has 74
overdue and 97 due this week, so an uncapped list is not something anyone can
scan.

## Status

Three states, one click each: **Not started → In Progress → Done**. This
replaces editing the Status cell in the spreadsheet.

A status you set is stored keyed by `machine|wo|die` — deliberately *not* the
sheet row it happened to sit on, since row numbers shift on every re-import.
Tested directly: `test/app-check.mjs` sets a status, reloads, then re-imports
the same workbook and confirms it is still there.

**Back order is tracked separately from progress.** The sheets write `IP BO`
for a line that is running *and* short of material. Reading that as a single
status silently loses the back-order half — 67 open lines in the sample data.
It is parsed into its own flag and shown as a red **B/O** badge beside the
status, and counted in the header.

## Latest shift update

The CNC workbook's **`Shift Update`** sheet carries the most current word on
most machines, finer than the per-line Status columns. Each centre page shows
its machine's entry above the queue: what ran, what is next, any notes, the
operator count, and a **MACHINE DOWN** badge when `#Ops` reads `DOWN`.

That sheet is laid out as two side-by-side blocks (columns 1–7 and 9–15), each
with its own Date/Shift header — both are read, and where a machine appears in
both the entry with actual content wins.

There are several near-identical sheets (`Shift Update 2`, `Shift Update (3)`,
`Shift Update Old`), all currently dated the same day. Only the one named
exactly **`Shift Update`** is read, and its date and shift are shown on the
panel so a stale one is obvious.

## What was removed

Everything driven by the Daily Schedule: order-level tracking, profile types
and per-profile material, the hinge/8560 rule, hand-added service orders, the
change history, shift-update posting, the process guide, the verification
screen, and the dashboard.

The stored data went with it. On first load the app rewrites its saved payload
without the retired fields, so an existing install — and the shared JSON on the
network drive — sheds them rather than carrying them indefinitely. State now
holds only `tasks`, `machineMeta`, `taskStatus`, `shiftUpdate`, `people` and
`settings`.

## Sharing

Each person connects once to the same JSON file (Chrome/Edge, File System
Access API). Statuses merge line by line — two people updating different lines
both keep their work; only the same line updated twice resolves to the most
recent.

Without a shared file the app still works fully, storing data in that browser.
Export / Import moves it between machines.

## Tests

```
npm install                        # once — installs esbuild + playwright
node test/machines-check.mjs       # parses both workbooks, checks the back-order flag
node test/app-check.mjs            # walks all four centre pages, status click, reload, re-import
node build.mjs && node test/standalone-check.mjs   # same against the built file, opened via file://
```

`test/app-check.mjs` writes screenshots to `test/screens/`.
