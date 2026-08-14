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

Three states, shown as an explicit segmented control: **Not started ·
In Progress · Done**. Tap the state you want — it does not cycle. Cycling
means a mis-tap silently advances a line and going Done → Not started takes
three taps; with gloves on, neither is acceptable.

Every change raises an **Undo** for a few seconds.

**Select lines and set them together.** Each line has a checkbox and each date
group has *Select all*; a bar appears at the bottom to apply one status to the
whole selection, also undoable. A shift finishing 74 overdue lines for one
project should not click 74 times.

This replaces editing the Status cell in the spreadsheet.

A status you set is stored keyed by `machine|wo|die` — deliberately *not* the
sheet row it happened to sit on, since row numbers shift on every re-import.
Tested directly: `test/app-check.mjs` sets a status, reloads, then re-imports
the same workbook and confirms it is still there.

**Back order is tracked separately from progress.** The sheets write `IP BO`
for a line that is running *and* short of material. Reading that as a single
status silently loses the back-order half — 67 open lines in the sample data.
It is parsed into its own flag and shown as a red **B/O** badge beside the
status, and counted in the header.

## Editing a line

Any line can be corrected by hand: **project, floor/tag, die, quantity and
cutting date**. Open a line with the pencil icon.

The **work order cannot be changed** — it is half the line's identity.

An edit is an *overlay*, not a rewrite of the imported data. The workbook's own
value is kept alongside it, so the edit dialog shows `edited · sheet: 16` next
to a quantity you changed to 21, and **Revert to workbook** puts it back.
Because overlays are keyed by the imported work order and die — never the
edited ones — correcting a die does not orphan that line's status, note or
history, and edits survive re-importing the workbook.

Edited lines carry an **edited** badge in the queue.

## History — who changed what, when

Every change to a line is recorded: status changes, bulk changes, undos, notes,
and each edited field with its before and after value. Each entry is stamped
with the person and the time, and the trail is shown at the bottom of the line's
edit dialog.

```
EDITED   qty     16 → 21          Abhay · just now
NOTE     — → Waiting on 3 bars from the mill.   Abhay · just now
STATUS   — → Done                 Abhay · just now
```

The log is append-only and merges by entry id across the shared file, so two
people working at once both keep their entries rather than one overwriting the
other.

## Notes

Any line can carry a free-text note — what is holding it up, what was short,
anything the next shift needs. Notes show inline on the line, are stamped with
who and when, and are searchable. This is the field the spreadsheets never had.

## Editing the setup

Each machine has a gear icon: rename it, change what it runs, and set the usual
operator count. Those overrides are stored with everything else and shared
through the same file, so the department's naming wins over the built-in
labels.

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
holds only `tasks`, `machineMeta`, `taskStatus`, `taskNote`, `taskEdit`,
`taskHistory`, `machineConfig`, `shiftUpdate`, `people` and `settings`.

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

`test/app-check.mjs` writes screenshots to `test/screens/`. It covers the
status control, undo, bulk apply, notes, line editing, the history trail,
machine rename, and that both a status and an edit survive a reload and a
re-import.

## Interface notes

- Everything is keyboard- and pointer-accessible; the segmented control uses
  `aria-pressed`, groups use `aria-expanded`.
- Icons are inline SVG — nothing is fetched, so the app still runs from a
  network share with no internet.
- Transitions are short (120–180ms) and are disabled entirely under
  `prefers-reduced-motion`.
- Light and dark both ship; the palette is defined once as tokens and only the
  values change under `prefers-color-scheme: dark`.
