# Cutting Tracker — Rolling, FOM, CNC & FMC, Multi Punch

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

## Re-import after an update

The workbooks are read **once, at import**. Everything the app derives from
them — the queues, the shift update — is stored, so a change to how the app
*parses* a file only takes effect the next time that file is imported. Until
then you are looking at what the old parser made of it.

Each import is stamped with a parser version, so the app notices this itself:
Setup shows **"Re-import the CNC workbook — this data was read by an older
version of the app"**, and the shift-update panel tags itself
*re-import to refresh* rather than presenting stale output as current.
Re-importing keeps everything you have set; only what the workbook says is
re-read.

## First run

1. **Setup** → import the Rolling workbook, then the CNC workbook.
2. Pick your centre from the nav: **Rolling · FOM · CNC & FMC · Multi Punch**.
3. Pick your machine from the sub-tabs, and work the queue.
4. At the end of the shift, **Shift Update** → Write.

The nav reads **Rolling · FOM · CNC & FMC · Multi Punch · Rush · Back Orders ·
Shift Update · Setup**.

To use it on a phone, set up **Sync across devices** in Setup once — see below.

## The pages

| Page | Machines | From |
|---|---|---|
| Rolling | Rolling (Auto/Etas), Rolling (Manual/Iota) | Rolling workbook: `Auto`, `Manual` |
| FOM | FOM 1, FOM 2, FOM 3 | CNC workbook: `FOM1`, `FOM2`, `FOM3` |
| CNC & FMC | Unassigned queue, CNC 1, FMC 1, FMC 2 | CNC workbook: `CNC & FMC` |
| Multi Punch | Multi Punch | CNC workbook: `MultiPunch & SAW` |

Machines with no lines scheduled still appear — a machine that is idle should
look different from one that does not exist.

## Moving jobs between machines

**Any centre with more than one machine lets you move a job to another one** —
FOM 1 → FOM 2 → FOM 3, Rolling Auto ↔ Manual, and across CNC 1 / FMC 1 / FMC 2.
Use the arrow button on a line, or select several and use **Move to** in the
bulk bar. The floor moves work between machines mid-shift; the tracker follows.

A moved line carries a small **`→ FOM 1`** badge naming the machine the workbook
has it on, so the operator whose machine it left can see where it went, and
**Put back on FOM 1, where the sheet has it** undoes it. Across a mixed
selection each line goes back to its own machine, not to one shared guess.

The move is an *overlay*, like everything else the app records. The line's key
stays built from the machine it was **imported** under, so moving it keeps its
status, note, history, rush and back order, and survives re-importing the
workbook. `test/app-check.mjs` asserts the key still starts with `fom1|` after a
move to FOM 2, because the alternative silently orphans everything attached to
that line.

### CNC & FMC starts unassigned

CNC 2 and CNC 3 are gone; **FMC 1 and FMC 2** took their place. That centre is
different from the others, because the workbook's `CNC & FMC` sheet has **no
machine column** — it is one flat list of `WO# · PROJECT · FL · Product · QTY ·
B/O · B/O Stat · Cutting Date · Status`, and there is no per-machine CNC
schedule anywhere in either workbook. (`CNC Daily` has a Work Center column but
is dated Sept 27th, and `Machine Schedule` is from Jan 29th — both long stale.)

So its lines import into an **Unassigned** queue, the first sub-tab, and are put
on a machine by hand. Elsewhere the sheet already says which machine a job is
on, and moving it is an override of that rather than a first assignment — the
dialog says which of the two it is doing.

**CNC 1 and CNC-3 are the same machine.** The shift-update sheet writes it as
`CNC-3` while the floor calls it CNC 1; both names map to one work centre so its
schedule and its shift-update entry land together.

## Running now

Switching to a machine's tab — any of them, Rolling through Multi Punch —
opens with a **Running now** panel above everything else: every line currently
**In Progress** on that specific machine, each with a one-tap **Done**. That is
the first question anyone switching to a machine's page actually has ("what is
this thing doing"), so it does not wait to be found by scrolling the
date-grouped queue below.

Busier machines run dozens of lines In Progress at once — Rolling (Auto) sits
around 60 — so the panel caps to a glanceable handful (rush lines first, then
soonest cutting date, same order as the queue) with a **Show N more**. A line
started through the app shows **since HH:MM**; one that arrived already
marked In Progress on the sheet shows no time, since the app never saw it
start. Nothing running shows a plain, quiet line rather than an empty panel
that looks like something broke.

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

## Rush

Nothing in either workbook says "this one first" — a rush is always somebody
deciding, usually because a shipping gate moved or site called. So it is
recorded as what it is: a flag, **the date it is actually needed by**, **who is
being told**, and **the reason**.

A rushed line sorts to the top of its machine's queue whatever its cutting
date, carries an amber `RUSH Aug 20` badge and a spine down its left edge, and
turns red once the date is inside two days or past. The centre header counts
them and there is a **Rush** filter pill.

The **Rush** page collects every rush line across all centres, bucketed by how
close its date is — **Past its date · Today · Next two days · Later · No date
given** — with an "only mine" toggle for the ones put on you. Clicking a row
opens the same dialog as the line does.

Every field change is logged to the line's history with who and when, the same
as everything else.

## Back orders

The workbook's flag is only the starting point. Any line can be opened from its
B/O icon to record **how many pieces are short, who is chasing it, and why** —
a note about the shortage itself, separate from the line's general note. The
badge grows from `B/O` to `B/O 12`, and the assignee and note show inline on
the line in a red band.

The flag is deliberately **tri-state**. Left alone it follows the workbook;
ticked it flags a line the sheet does not; unticked it records that a shortage
the sheet still reports has been *resolved*. Without that third state there is
no way to close out a shortage the workbook keeps asserting.

The **Back Orders** page cuts across all four centres and groups by assignee,
Unassigned last, with a running total of lines and pieces short and an
"only mine" toggle — whoever chases material does not care which machine the
shortage sits on. Clicking a row opens the same dialog as the line does, so a
shortage is recorded in exactly one place.

One thing to know about the sheet's own `B/O` column: it counts **bars**, not
pieces, and FOM 2 / FOM 3 write it as text (`3 BARS`, `1 BAR MISSING`). It is
kept and shown as context beside the piece count rather than being forced into
a number.

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

## Shift update

Its own page, laid out the way the department's sheet already is: one block per
machine with **#Ops, Work done / in progress, Next in schedule and Notes**,
grouped by centre so Rolling, FOM, CNC and Multi Punch are visually separate
rather than one long list. The three standing rows — **Service Orders, K1285
Pulls, Back Order** — sit at the top exactly as they do on the sheet.

Pick the **date** and the **shift** (Day · Afternoon · Midnight), then **Write**
or **Read**.

**Writing is mostly picking, not typing.** Every card offers two sources:

- **Moved this shift** — lines whose status someone actually changed inside
  that shift's hours, read back out of the history log and phrased the way the
  sheet phrases them (`One Yonge 71-74R2 (S80.234) — Done`). The app already
  watched the shift happen; it should not have to be retyped.
- **From the workbook** — the machine's entry from the imported `Shift Update`
  sheet. **Pull last update** drops the whole entry into the three boxes, or
  single lines can be picked off as chips. A chip already written into the box
  turns green and stops being offered.

A card with anything in it gets a green spine, and the section header counts
`3/5`, so what is still blank is obvious without reading any of it. Shift
windows are Day 07:00–15:00, Afternoon 15:00–23:00, Midnight 23:00–07:00 —
the last crossing into the next day.

**Reading** is a clean block per machine, plus **Copy as text**, which lays the
whole update out as plain text for pasting into an email or a chat. Recent
updates are listed at the bottom; clicking one jumps to it.

Updates are stamped with who wrote them and when, saved under `date|shift`, and
merged record-by-record through the shared file like everything else — so two
people writing different shifts do not overwrite each other.

### The imported sheet

The CNC workbook's shift-update sheet carries the most current word on most
machines, finer than the per-line Status columns.

**It is only ever as fresh as the file.** The panel shows the entry's date and,
beside it, how old that is — *today*, *yesterday*, *3 days old* — because
"Latest shift update" next to a bare date reads as current even when it is days
behind, which is exactly how a day-old entry got taken for today's. The
suggestion chips on the Shift Update write page are dated for the same reason:
offering them unlabelled next to this shift's own tracked work invites pasting
yesterday's report into today's. Besides feeding the
suggestions above, each centre page shows its machine's entry over the queue,
with a **MACHINE DOWN** badge when `#Ops` reads `DOWN`.

**Which sheet that is, is decided by which tab is visible in Excel** — not by
its name. The workbook holds four similarly-named ones (`Shift Update 2`,
`Shift Update`, `Shift Update (3)`, `Shift Update Old`) and only the first is
visible; the department has hidden the other three, along with 58 of the
workbook's 73 sheets. Hiding a tab is how they archive it, so visibility is
their own signal for which one is live, and the rule keeps working if they
rename or reorganise.

This was got wrong twice before landing on that: once reading all four sheets
and merging them by date and shift label, which let a stale "Afternoon" block
beat the live "Day" one; then pinned to `Shift Update 2`, which only looked
right because that is the visible one today. If every shift-update tab is ever
hidden, the app falls back to the fullest of them and the import report says
`fromVisibleTab: false`.

A block is laid out as two side-by-side halves (columns 1–7 and 9–15), each
with its own Date/Shift header. Blocks also **stack vertically within that one
sheet**: an empty leftover template sits at the top, and the live one — the
only place **FMC 1 and FMC 2 appear at all** — starts at row 57. Both halves
are read, every block is found by its own Date header, and entries merge per
machine on one rule: **a block that describes actual work always beats an empty
one**, and a filled-in `#Ops` headcount with no done/next/notes does not count
as work. Only when both are equally (un)filled does date+shift decide.

**The live block calls the remaining CNC machine `CNC-3`, not `CNC 1`.** Both
map to the same work centre, so the app shows its real entry rather than the
blank `CNC 1` placeholder left in the stale block above. The machine is still
labelled *CNC 1* in the app — rename it in Setup if the floor calls it CNC-3.

Machine names on the sheet that the app has no work centre for are collected
and reported on import rather than dropped in silence — that is how the
department finds out the app is behind the floor again. Right now that list is
`CNC 2, CNC 3, CNC SBZ140, CNC-3, Notching, Proline, Elumatec Saw #1–3,
Saw #1–8`.

**One thing to settle:** the newest block writes **`CNC-3`**, not `CNC 1`. The
app is set up as CNC 1 + FMC 1 + FMC 2, so `CNC-3` currently goes to the
unrecognised list. If the remaining CNC is really called CNC-3 on the floor,
rename `cnc1` in `js/machines.js` and add `'CNC3': 'cnc1'` to `SU_MACHINE` in
`js/import-machines.js`.

## What was removed

Everything driven by the Daily Schedule: order-level tracking, profile types
and per-profile material, the hinge/8560 rule, hand-added service orders, the
change history, shift-update posting, the process guide, the verification
screen, and the dashboard.

The stored data went with it. On first load the app rewrites its saved payload
without the retired fields, so an existing install — and the shared JSON on the
network drive — sheds them rather than carrying them indefinitely. State now
holds only `tasks`, `machineMeta`, `taskStatus`, `taskNote`, `taskEdit`,
`backOrder`, `rush`, `taskAssign`, `taskHistory`, `machineConfig`,
`shiftUpdate`, `shiftLogs`, `people` and `settings`.

(Shift-update posting has since come back, rebuilt around the machine layout —
see above. An old install's `shiftLogs` were written in a different shape and
are dropped on load rather than half-rendered.)

## Sharing

There are two ways to share, and they use the same per-record merge: every
record carries an `at` timestamp and the newer one wins, so two people updating
different lines both keep their work and only the same line updated twice
resolves to the most recent.

### On the shop floor PCs — a shared file

Each person connects once to the same JSON file on the network drive
(Chrome/Edge, File System Access API). No account, no internet.

### On phones — sync across devices

No phone browser has the File System Access API, so the shared file cannot
work there. **Setup → Sync across devices** connects the app to a free
[Supabase](https://supabase.com) project over plain HTTPS instead, and then the
same board is open on a phone on the floor and a PC in the office at once.

1. Make a free project at supabase.com.
2. Run the setup SQL once (Setup shows it, with a copy button). It creates one
   `tracker_state` table and three policies.
3. Paste the **Project URL** and the **anon public key** from Settings → API.
4. Do the same on every phone and PC, with the same **site name**.

The snapshot is pushed as **two documents, not one**:

| | what | size on the real data | pushed |
|---|---|---|---|
| `base` | the imported workbooks | ~1.6 MB | only on re-import |
| `work` | statuses, notes, edits, rush, back orders, assignments, shift updates, history | ~1 KB | debounced, on every change |

Together that would mean a phone uploading the workbooks every time somebody
taps Done. Split, a tap costs a kilobyte. `test/cloud-check.mjs` asserts the
`work` document stays at least five times smaller than `base` and never carries
the task list.

Pulls poll every 30 seconds while the tab is visible, and immediately when you
come back to the app — which on a phone is exactly when its copy is most likely
to be stale.

**The trade-off, plainly:** those policies let anyone holding the address and
the anon key read and write the department's data. There is no login. Keep the
key to the department, the same way the network share is kept to the
department. If that is not acceptable, the shared file on the network drive
gives up phones and keeps everything inside the building.

Without either, the app still works fully, storing data in that browser.
Export / Import moves it between machines.

### Putting it on a URL

`.github/workflows/pages.yml` publishes the built single file to GitHub Pages
on every push to `main`. Enable it once in **Settings → Pages → Source: GitHub
Actions**; the workflow will not do anything until you do. `manifest.webmanifest`
means **Add to Home Screen** on a phone opens it like an app.

## Tests

```
npm install                        # once — installs esbuild + playwright
node test/machines-check.mjs       # parses both workbooks, the back-order flag, the shift update
node test/app-check.mjs            # walks every page: status, rush, back orders, assignment, shift update
node test/cloud-check.mjs          # two devices against a mock cloud — do they converge?
node build.mjs && node test/standalone-check.mjs   # same against the built file, opened via file://
```

`test/app-check.mjs` writes screenshots to `test/screens/`. It covers the
status control, undo, bulk apply, notes, line editing, the history trail,
machine rename, the back-order dialog and page including the tri-state clear,
and the shift update — pulling the workbook entry, inserting a chip, saving,
and reading it back after a reload. It also asserts that a status, an edit and
a back order all survive a reload and a re-import.

`test/cloud-check.mjs` is the one worth knowing about. There is no Supabase to
reach from a test, so it stands up a mock that speaks the same PostgREST
shapes the client uses — the `site=eq.` / `part=in.()` filters, the
`on_conflict` upsert with `Prefer: resolution=merge-duplicates`, and the CORS
preflight that the `apikey` and `Prefer` headers force a browser to send.
Getting any of those wrong fails there rather than on the shop floor. It then
drives two browser contexts with separate storage as two people: the PC imports
the workbooks and sets a status, a rush and a note; the phone connects having
never seen a workbook and must receive all of it; both then edit different
lines and must converge without losing either. It also asserts a wrong key
produces a sentence an operator can act on rather than a stack trace.

## Interface notes

- Everything is keyboard- and pointer-accessible; the segmented control uses
  `aria-pressed`, groups use `aria-expanded`. **Keyboard focus draws a visible
  ring** on every interactive element via `:focus-visible`, so it never shows
  for pointer users.
- **Contrast meets WCAG AA.** `--ink-3` carries most of the secondary text on
  the page — stat labels, dates, counts — and used to sit at 2.9:1 on white,
  which fails. It is now 4.8:1 light and 5.1:1 dark. On a shop floor under
  glare that is the difference between readable and squinted at.
- **Elevation is tokenised** (`--shadow-1/2/3` plus `--sheen`) because dark
  mode cannot reuse light-mode shadows: a black shadow on a near-black surface
  is invisible, which is why the dark theme used to read completely flat. Dark
  adds a hairline top highlight instead.
- Numbers use `font-variant-numeric: tabular-nums` globally — quantities down a
  column and counts across the stat strip are read against each other.
- Icons are inline SVG — nothing is fetched, so the app still runs from a
  network share with no internet. No web fonts either, for the same reason.
- Transitions are short (100–180ms) and are disabled entirely under
  `prefers-reduced-motion`. Buttons depress on `:active`: with gloves on, that
  is most of the confirmation you get that a tap landed.
- Light and dark both ship; the palette is defined once as tokens and only the
  values change under `prefers-color-scheme: dark`.
- **On a phone** the header collapses to one row — the tagline is dropped and
  the nav moves below with `order`, reclaiming about 100px of vertical space
  before any content. The nav scrolls horizontally in a single row rather than
  wrapping to three.
- **There is a print stylesheet.** Printing a queue or a shift update for the
  floor is a real thing people do with a page like this; it hides the nav,
  sticky headers, per-line tools and the action bar, and keeps rows from
  breaking across pages.
