# Cutting Tracker — Rolling, FOM, CNC & FMC, Multi Punch

A page per work centre, driven by the department's own Rolling and CNC schedule
workbooks. Each page shows that machine's open lines grouped by cutting date,
with a single click to move a line through Not started → In Progress → Done.
The separate Daily Schedule workbook supplies a read-only daily/project view;
it never drives machine routing or machine status.

The scope stays operational rather than becoming a general ERP: no purchasing
workflow or inventory ledger. It includes the actions the cutting floor needs
around the queues — daily/project reference, staging, rush work, back-order
chasing, engineering lookup, forms, employee selection and shift handoff.

## Running it

**Recommended — use the online app.** Open the [hosted Cutting
Tracker](https://x-phenomenal-x.github.io/Fabrication-Production-Tracker/) in
Chrome or Edge. It loads as separate cacheable modules, installs from the
browser and keeps the operational shell available when the signal drops.

**Shared-drive fallback.** Download `Cutting-Tracker.html` and double-click it.
That self-contained rollback copy needs no server or internet, but it is much
larger because every module and engineering drawing is embedded in one file.

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

1. **Setup** → import the Rolling workbook, the CNC workbook, and the separate
   Daily Schedule workbook.
2. Pick your centre from the nav: **Rolling · FOM · CNC & FMC · Multi Punch**.
3. Pick your machine from the sub-tabs, and work the queue.
4. At the end of the shift, **Shift Update** → Write.

The nav reads **Overview · Rolling · FOM · CNC & FMC · Multi Punch · Jobs ·
Today · Daily Schedule · Projects · Staging · Rush · Back Orders · Forms ·
Employees · Engineering Lookup · Shift Update**. Setup is the gear in the
header.

To use it on a phone, set up **Sync across devices** in Setup once — see below.

## The pages

| Page | Machines | From |
|---|---|---|
| Rolling | Rolling (Auto/Etas), Rolling (Manual/Iota) | Rolling workbook: `Auto`, `Manual` |
| FOM | FOM 1, FOM 2, FOM 3 | CNC workbook: `FOM1`, `FOM2`, `FOM3` |
| CNC & FMC | Unassigned queue, CNC 1, FMC 1, FMC 2 | CNC workbook: `CNC & FMC` |
| Multi Punch | Multi Punch | CNC workbook: `MultiPunch & SAW` |
| Daily Schedule | Cutting-department day view grouped by project | Separate Daily Schedule workbook: exact `Daily Sched` sheet |
| Projects | Project name, job code, colour/finish and series directory | Separate Daily Schedule workbook: exact `Daily Sched` sheet |
| Forms | Downloadable blank production, incident and orientation PDFs | Versioned templates in `assets/forms/` |
| Employees | Searchable device/user selector and locally managed employee list | Saved `people` records; no real roster is committed |

Machines with no lines scheduled still appear — a machine that is idle should
look different from one that does not exist.

## Printing

The app now builds clean paper documents instead of sending the interactive
screen chrome to the printer:

- **Machine schedule:** open the machine tab and choose **Print schedule**. It
  prints every row in the current search/filter view, including rows hidden by
  collapsed groups or the on-screen display cap. The heading records whether
  completed lines, a status filter, or a search were applied.
- **Shift update:** choose **Print update** from either Write or Read. A draft
  is clearly marked `DRAFT — NOT SAVED`; a saved update carries its author and
  timestamp. Empty updates cannot be printed.
- **Blank shift update:** choose the date and Day or Afternoon, then use
  **Print blank**. It prints Back Order and every active machine with the shift
  hours, break times, handwriting space, general-note lines and signoff.
- **Daily schedule:** open **Daily Schedule**, choose the date, then use
  **Print day**. It prints the complete filtered day grouped by project.
- **Assembly or extrusion:** search in **Engineering Lookup**, open a record,
  then choose **Print**. Assembly sheets include the drawing, component map,
  missing-role state and recovery provenance. Extrusion sheets include the
  profile card, engineering numbers and reverse assembly usage.
The browser's normal print dialog still chooses the printer, copies or **Save
as PDF**. Machine schedules and shift updates use landscape Letter; engineering
records use portrait Letter. Every paper header uses the exact same three-shape
BV mark as the screen. Print actions stay hidden in wall-monitor mode.

## Jobs — one work order across the department

**Jobs** answers the question the machine pages cannot: where a whole work
order has reached across Rolling, FOM, Punch and CNC/FMC. Each card shows its
station rail, completed/running/remaining counts, pieces, rushes, shortages and
parked lines. Expanding it reveals every die against every station it touches;
an empty cell means the die never visits that station, not that it is waiting.

Choose a die to open the first unfinished line on the correct machine. The same
job view is available from a line inspector, so an operator can check upstream
progress without leaving the queue. Jobs is derived from the live lines and
stores no second copy, so it cannot drift away from machine status.

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

### Parking work that will not run

**Park** is for a scheduled line the department has decided not to run: a
cancelled job, a changed elevation, or a die remade under another work order.
It is not Done. Parking removes the line from open, overdue, running and Today
counts while preserving the schedule record, the reason, who made the decision
and its history. Parked lines remain reachable through the machine's **Parked**
filter and can be restored.

One line can be parked from its inspector, or a selected group can be parked
under one shared reason and undone as a batch. The record is a synced overlay,
so it survives workbook re-imports instead of reappearing as open work.

## The die lookup

A die on the schedule is a **rolled sub-assembly**, not one extrusion. It is an
exterior, an interior, and a thermal break top and bottom, combined in the
sub-assembly room and then rolled — `S80.106` "Typical Vertical Male Frame" is
`80-113` outside, `84-901` upper and lower, `80-105` inside. The app knew the
number on the schedule and nothing about what it is made of, which is exactly
what staging has to pull.

`js/subassemblies.js` holds **997 sub-assemblies** across the 8000–8950 series,
generated by `tools/parse-subassemblies.mjs` from the Sub-Assembly Section Book
PDFs. Emitted as arrays rather than objects: this ships inside the single file
that opens off a network share, and repeating the keys 930 times costs more
than the data.

**The schedule and the book write the same number differently**, which is the
only real work in `js/dies.js`:

| schedule | `S80.106` | `S80.143HT` | `85.228` |
| book | `SA80-106` | `SA80-143HT` | `85-228` |

An `S` prefix means a sub-assembly and a bare number means a component
extrusion, so both readings are tried and both directions answered:

- *what is S80.106?* → its four components, with the thermal break shown once
  as `×2 top and bottom` rather than listed twice
- *where does 80-105 go?* → every sub-assembly using it — 16 of them. This is
  staging's question, and the reverse index is the reason it can be asked.

**Engineering Lookup is one Department Tools page** for both rolled assemblies
and their individual extrusion profiles. One search accepts an assembly number,
profile number, description, supplier, proposed number or final die number.
Results stay typed as **Assembly**, **Profile reference**, or **Extrusion**, so
combining the search does not blur what the record means. An exact assembly
search also returns its linked individual profiles. Tapping any reviewed
component opens that drawing in the same workspace; reverse usage leads
straight back to each assembly.

The header magnifier opens the page. Tapping a die on a queue or staging line
opens the same unified lookup as a quick dialog.

`S80.106`, `SA80.106`, `SA80-106`, and separator-free `S80106` are accepted as
equivalent spellings.
`test/app-check.mjs` asserts all four resolve to `SA80-106` with exactly
`Exterior 80-113 · Thermal break 84-901 ×2 · Interior 80-105`, that the reverse
lookup finds it from `80-105`, and that an unknown die resolves to nothing
rather than a wrong guess.

### Missing component-number recovery

The Listings contain 330 assemblies with at least one empty component field.
The lookup now safely recovers **64 exterior/interior fields across 47
assemblies** where every matching standard/HT/HTX sibling agrees. Each recovered
value is visually distinct and names the assembly it came from. Thermal-break
fields are never inferred because they can legitimately change by variant.

It also exposes **68 additional extrusion-number references across 66 rows**
that are present in Listing descriptions but absent from the four component
columns. All 68 link to reviewed extrusion-master records. Fifty-three are
explicit component-only rows such as `S89.083HT → Thermal break 84-909`; these
now show and print the referenced profile drawing instead of an empty assembly
card. They remain profile references rather than being given invented exterior
or interior roles.

Nineteen component numbers written directly in verified Listing columns are
not present in the twelve reviewed extrusion masters. The lookup keeps those
numbers and says that no reviewed profile drawing is available; it does not
substitute a similar-looking extrusion.

### Extrusion drawing library

The profile side of the library is generated from twelve engineering masters:
2000 Series and the
8000 through 8950 Series. It contains **1,680 reviewed profile drawings**.
Numbered template cells without an actual profile are deliberately excluded;
obsolete, discontinued, and cancelled profiles remain available and are
labelled because their replacement history is still useful on the floor.

`tools/extract-extrusions.py` is an offline generation step. The AutoCAD table
text in these PDFs is plotted as paths, so the extractor uses local OCR and
then applies the small, page-and-cell correction set recorded from visual QA.
`tools/build-extrusion-data.py` emits the dependency-free browser modules. The
22.9 MB image map is loaded only when someone selects an extrusion result, so
ordinary production pages do not fetch it on phones.

### The drawings

Each series also has a drawings PDF: one page per sub-assembly, a section
through the assembled profile with every component called out where it sits.
The listing tells you `80-113` is the exterior; the drawing tells you which
piece that is on the rack.

`js/drawings.js` carries **883 pictures, 2.9 MB**, keyed by sub-assembly. Each
page is cropped to the drawing itself — the revision table, the components
table and the title block are dropped, since the first two repeat what the app
already knows and the third is letterhead — then rendered 1-bit at 720px and
encoded as lossless WebP. That takes a page from ~280 KB of PDF to about 3 KB,
which is what makes carrying hundreds of them inside a single offline file
possible at all. They keep a white ground in dark mode: inverted line art no
longer matches the paper drawing next to the machine.

**The current library uses full Series PDF sheets throughout.** The clearer
8000 Series sets replaced the older Listing thumbnails, so every carried
picture now has dimensions and component callouts. `DRAWING_SOURCE` remains
able to identify a fallback thumbnail if a future incomplete series needs one,
but the current build does not use any.

That is **883 full sheets and zero thumbnails**. `S89.083HT` has no assembly
sheet because its source row is not a four-part assembly: it explicitly names
the `84-909` thermal-break profile. Engineering Lookup now resolves that source
relationship and uses the reviewed `84-909` master drawing on screen and in
print. `drawingFor('SA89-083HT')` correctly remains null rather than pretending
the individual profile card is an assembly sheet.

```
tools/extract-listing-thumbs.py <dir-of-listing-pdfs> thumbs.json
tools/extract-drawings.py <dir-of-drawing-pdfs> js/drawings.js thumbs.json
tools/replace-series-drawings.py js/drawings.js tools/8000-series-drawing-map.json <dir-of-8000-pdfs> <pdftoppm>
```

The thumbnails are cut by row position rather than by an assumed row height:
`pdftotext -bbox` gives the y of each assembly number in its own column, and
the band around it is half the gap to its neighbours, so a part-full page
crops as cleanly as a full one.

### Regenerating it

The book is a folder of PDFs in Drive — one drawing set and one **Listing** per
series. The Listings carry the data:

```
pdftotext -layout "SA-Master Template - 8000 Series Listing.pdf" 8000.txt
node tools/parse-subassemblies.mjs <dir-of-txt> > js/subassemblies.js
```

**A series can also be recovered from its drawings.** Every drawing sheet
carries the same components in a cleaner table than the listing does — one
header line and one row of four values — so when a listing PDF cannot be
fetched, running the drawings PDF through `pdftotext -layout` into the same
directory recovers it. That is how the 8000HTX series got in.

Two things the parser has to get right, both of which were wrong first time:
the HT and HTX variants suffix the number (`SA83-001HT`), so allowing a
single trailing letter parsed three whole series as **empty**; and labels do
not reliably start a line — where a description runs long the extractor merges
it with the component column, which silently dropped a T-break and an interior
until the scan looked for labels anywhere in the line.

## Staging

The step before the schedule's first machine, and the one the department judges
itself on: staging is done well when the next shift walks in to a job that is
already there. Nothing tracked it before — it lived in a hidden `Rolling
Staging` sheet and in people's heads.

**A line that has already started is past staging.** Only rolling lines that
have not been started appear — anything running or finished is on the machine
already, and listing it as needing prep sends the stager after a job the roller
is standing over. On the real Rolling schedule that is the difference between
260 lines on the list and 183.

It is an **overlay on the rolling lines**, not a queue of its own, so a line is
the same line whether you are staging it or rolling it: same work order, same
status, same notes and shortages. `state.staging[key]` holds
`{ staged, stageFor, at, by }` against the same key everything else uses, so it
survives re-import like every other overlay.

**"Stage for" is a shift, not a date.** The whole point is that a named crew
walks in to it, so the picker offers the next few shifts starting with the one
*after* the current one — you stage for what is coming, not for the shift you
are standing in. It is stored as `date|shift` so it sorts, and shown the way it
is said on the floor. Staging without naming a shift is still one tap.

A staged line carries a `staged` badge on the Rolling queue, so the roller
knows before starting and the stager can see it registered.

## The saw

Heights come off rolling to the **Elumatec saw**, and the same heights then go
to the punch. It is a station in the Multi Punch centre.

The workbook's `MultiPunch & SAW` sheet has a `SAW` column, but it is **empty** —
it is the `PUNCH` column the department actually fills in, on 30 of 64 lines.
So the saw is run off the floor's own knowledge rather than off the file, and
its lines are put on it by hand — which is exactly what the learned routing
above then picks up. Both columns are now read into the task instead of being
declared and discarded.

## One job, several stations

A work order and die is **one job**, and it is worked at more than one station:
rolled, then cut, then punched, then machined. The workbooks carry a row per
station, and those rows go stale independently — different people keep different
sheets and they fall behind at different rates.

**609 of the 3,228 scheduled jobs span two or three machines, and 99 of them
have a later station finished while an earlier one does not.** W/O 30996
S80.104 is the shape of it: `roll-auto: IP`, `fom2: DONE`. It cannot have been
cut at FOM 2 without being rolled first — rolling's row is simply stale.

So **a finished station finishes the ones before it.** The stages are the
routing SOP's own order, collapsed to the part that is a straight line:

```
1 rolling      2 cut                3 punch        4 machining
  Auto/Manual    Saw · FOM 1/2/3      Multi Punch    CNC 1 · FMC 1/2
```

On the current schedules this settles **56 lines** — 52 finished by a later
station, 4 shown as running because a later station is. Open lines drop from
738 to 686, and the staging list from 183 to 144: **39 jobs were being queued
for prep that had already been through it.**

Three rules keep it honest:

- **Only ever forward, and only from a strictly later stage.** Rolling being
  done says nothing about whether FOM 2 has cut it. Two rows at the *same*
  station are two real pieces of work — one job can have two FOM 2 rows for
  different elevations — and neither finishes the other.
- **A merely started station downstream proves less.** It says the material got
  there, so the earlier station is not untouched; it does not say the earlier
  station finished. Claiming that would be the same stale-data mistake pointing
  the other way.
- **An operator's own update always wins.** They looked at the material; the app
  only looked at another row.

### It says so on the line

Nothing is written to storage and nothing is attributed to a person. A status
nobody set carries a dashed **`→ from Multi Punch`** badge, the three-way
control is outlined rather than filled, and the accessible name says *"Done,
worked out from a later station"*. A `Done` with no name against it should mean
somebody looked at the material; here nobody did, and the app says so.

Because it is derived rather than stored it also self-corrects: fix the
downstream row, or re-import, and the inference follows. Everything reading
`effectiveTaskStatus` — open counts, the Today board, Rush, Back Orders,
staging, the shift update — picks it up for free.

`test/app-check.mjs` asserts it on the real W/O 30996, checks that **no
inference points backwards up the line** across the whole book, and that an
operator setting a status beats it.

## Routing — the SOP first, habit second

The department has a written standard for how window wall and vents move:
**SOP-WW-CUT-008 v8.0**, *Window Wall & Vents Material Flow*, effective August
2026. It is a flowchart with five leaves, and `js/routing.js` is that flowchart.
A written rule outranks a counted habit, so where the SOP covers a line its
answer wins; everything else falls back to [learned routing](#learned-routing).

Two tracks that never mix:

```
WINDOW WALL   raw stock ─ Auto Rolling ─┬─ widths  ─ …
                                        └─ heights ─ Elumatec Saw ─ Multi Punch ─ (FMC)
VENTS         separate entity ─ Manual Rolling ─ FOM 3 ─ Vent Assembly
```

On the **widths** line the order of the questions is the whole rule:

| | |
|---|---|
| die ends `HT` / `HTX` | **FOM 2 only** — skips the saw and the widths punch |
| `SA80-104/105/255/256/261` | Elumatec Saw → Widths Punch |
| anything else | FOM 2, skipping the saw and the punch |

**Heights** go saw → punch, and on to an **FMC** only for pin holes, ISV, or die
`SA80.235`/`236`.

### What the app cannot know, and says so

The schedules carry no column for widths, heights or vents, so the track is read
off the machine the workbook already has the line on. Where that is a guess the
line says which guess and why — *"the section book calls this die vertical"* —
so it can be overruled by moving the line.

**High thermal is a widths question, and only a widths question.** Asking it too
early is the mistake this code made first: `SA80-106HT` is a *vertical* male
frame, so it is a height and belongs to the saw, and treating every HT die as a
width sent a third of auto rolling to FOM 2. The flowchart only asks about high
thermal once material is already on the widths line, and so does the app.

**The SOP is window wall and vents, and nothing else.** The same rolling
machines also run sliding door, flashing and door sash, and FOM 1 is the
8900-and-screen machine. Window wall is the 8000 series and the vent line is the
8500s; outside that, `routeFor()` returns null rather than inventing a route —
696 of the 3,917 scheduled lines, and they keep the learned suggestion.

### What it shows

Every line has a **routing** button: the stations it passes through in order,
which one it is standing at now, and against each the **paperwork that has to
travel with it** and whose office to get it from — *Heights cutsheets (set 2 of
2) — Firas's office, if not already at the saw*. That half of the SOP is why
this is a page and not a badge: knowing a height goes to the saw is no use if
the cutsheets are still in an office.

Where the SOP decides the machine, the line's route badge reads **`SOP: FOM 2`**
and is solid rather than dashed — a rule, not a tally. It is still only ever
offered, never applied on its own.

A line standing at a machine that is **not on its own route** says so in red.
That is not a rendering gap: it means the schedule and the standard disagree
about that job. Right now 300 lines are in that state — all five-saw-die lines
scheduled on FOM 2.

`test/routing-check.mjs` walks every leaf of the flowchart, then the real
workbooks: 472 lines through the widths saw, 696 outside the SOP, 300 off their
route.

## Learned routing

The CNC & FMC sheet says nothing about which machine runs a line, so all of it
lands in the Unassigned queue and someone puts each one on CNC 1, FMC 1 or
FMC 2 by hand. The same components come back week after week and the floor
already knows where each goes — that knowledge just lived in someone's head and
got re-applied eighty times per import.

So it is read back out of what people actually did. Every hand assignment is a
decision about a **die**; count them per die and the app can say *this one
usually goes on FMC 1, seven times out of eight*, and offer to do it — on the
line as a one-tap `usually FMC 1`, and for the whole queue as a single
**Route them** action with a breakdown of what goes where.

It is **derived, never stored**. There is no learned-routes table to drift or
to sync: it is a view over the assignments themselves, so correcting a habit
corrects the suggestion and clearing an assignment un-teaches it. It only ever
suggests within a line's own centre — a die seen on FOM 2 says nothing about
which CNC should take it — and never for a line that is already assigned or
already finished.

**One sighting is a coincidence, not a habit.** A suggestion needs at least two.
And nothing is ever applied on its own: routing a line to the wrong machine has
a real cost, and the person reading the row is the one who knows whether this
time is different.

`test/app-check.mjs` assigns a component twice, asserts the third line carrying
it is recognised — and that one assignment is *not* enough — then routes the
queue in one action and checks the recognised line moved.

## What is running, in the shift update

A machine's card offers three sources now, kept visibly apart because they are
different claims:

- **What this shift moved** — status changes recorded here inside the shift's
  own hours. Fact, but only as complete as the app's use.
- **In process now** — what the schedules say is running on that machine,
  whoever set it and whenever. This includes the workbook's own `IP` marks,
  which is most of them until everyone is on the app.
- **From the workbook** — the `Shift Update` snapshot, dated, because it is
  only as current as the last time the file was saved.

## Adding a job by hand

The schedules are the source of truth, but the floor runs work that is not on
them yet — a remake for a broken piece, a service order phoned in, a job the
office has not entered. **＋ next to the machine name** adds one.

A manual job is task-shaped and keyed exactly like an imported line, so every
overlay already in the app works on it with nothing special: status, note,
rush, back order, moving it to another machine, history. It carries an
`added here` badge, because whether a line came from the workbook changes what
a re-import will bring up to date.

It is stored in `state.manualTasks`, **not** in `state.tasks`. That is the
whole point: `setMachineImport()` replaces every task belonging to an imported
machine, so a manual job living in `tasks` would be wiped by the next
re-import of the workbook covering its machine — which is exactly when someone
would be relying on it. `test/app-check.mjs` adds a job, sets it In Progress,
re-imports the CNC workbook, and asserts both the job and its status survive.

It also **steps aside on its own**. Once the workbook imports a line with the
same machine, work order and die, `tasksInScope()` drops the manual copy — and
because the key is identical, the workbook's line inherits the status, note and
history that were recorded against it.

## Today

One page for "what has to happen", in two halves.

The top half is the department's own list — jobs no schedule knows about.
Chase the mill, change a blade, walk a drawing over, ring the shipper. Typed
in, ticked off, attributed. **An unfinished job follows the day forward**
rather than vanishing at midnight, carried with an amber rail and a `from
Aug 13` chip, because something outstanding does not stop being outstanding.
Finished ones stay visible until the end of the day — seeing what has been
cleared is half of what the list is for.

The bottom half is derived and stores nothing: running now, overdue, due
today, rush needed today or already past, back orders — each a way in to the
page that actually handles it, so this is a starting point rather than a fifth
place to record the same thing. Underneath, whether the **current shift has
been written up**, which is the one item on the day's list whose deadline is
attached to the shift rather than to a job.

The list works with no schedule loaded; only the derived half waits on an
import.

### Photo to To-Do

The Today list can turn a **camera photo or an existing image** of a handwritten
list, whiteboard or printed floor note into proposed To-Dos. It is a review
workflow, not an automatic import:

1. Take or choose a JPEG, PNG or WebP image.
2. Optionally tell the assistant what part of the note matters.
3. Review the short conversation summary and edit, assign, include or exclude
   every proposed item.
4. **Add selected** writes only those approved strings through the existing
   `addTodo()` path.

The browser scales the photo to at most 1600 px before upload. The image exists
only in the open dialog and one Edge Function request; it is never placed in
`state`, localStorage, the shared JSON file, Supabase tables or a printout. The
OpenAI request sets `store: false`. Closing the dialog drops the preview and
result. The feature is online-only, while typed To-Dos remain fully offline.

Model output is constrained to twelve concise actions. Unknown names stay
unassigned, uncertain text is marked **Check wording**, and the prompt forbids
invented quantities, dates, routes and completion. It also explicitly excludes
purchasing and material-order creation. Nothing reaches the shared list until
an operator approves it.

The client module is dynamically imported on the first press and excluded from
the PWA precache. Devices that never use photo analysis do not pay for it on
first load.

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

## Back Orders — operational shortage chasing

The workbook's flag is only the starting point. Any line can be opened from its
B/O icon to record **how many pieces are short, who is chasing it, and why** —
a note about the shortage itself, separate from the line's general note. The
badge grows from `B/O` to `B/O 12`, and the assignee and note show inline on
the line in a red band.

The flag is deliberately **tri-state**. Left alone it follows the workbook;
ticked it flags a line the sheet does not; unticked it records that a shortage
the sheet still reports has been *resolved*. Without that third state there is
no way to close out a shortage the workbook keeps asserting.

The **Back Orders** page cuts across all four centres and groups the chase list
by assignee, with Unassigned last and an "only mine" toggle. Clicking a row
edits the same shortage record shown on its machine queue. This remains an
operational follow-up surface; it does not prepare purchase requests, count
bars to buy or submit anything to a purchasing workbook.

One thing to know about the schedule's own `B/O` column: it counts **bars**,
not pieces, and FOM 2 / FOM 3 write it as text (`3 BARS`, `1 BAR MISSING`). It
is kept and shown as context beside the manually recorded piece count. The app
does not convert either figure into an order.

FOM 2 rows explicitly marked `8560` or `8560 HT` carry a production badge with
the confirmed **one hinge per vent** requirement. Ordinary `P:Y` pin-hole rows
are excluded. A blank vent quantity stays visibly uncounted rather than
becoming zero.

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

Two different things can answer "what is the last shift update for this
machine", and they are not the same claim. The workbook's `Shift Update`
sheet is a snapshot from whenever the file was last saved. An update written
on the Shift Update page is the department's own record, typed during the
shift it describes.

**The newer of the two wins on the machine page, and the panel says which it
is** — green and "written here", or neutral and "from the workbook". This was
wrong until it was reported: a machine page kept showing the workbook's
snapshot even after someone had written up today's shift in the app, so FOM
and Rolling reported the previous day's work however correctly the sheet had
been parsed. `shiftUpdateFor()` in `js/model.js` now merges both sources;
`test/app-check.mjs` asserts a written update outranks the workbook and that a
machine nobody wrote up still falls back to it.

Only the workbook half can record a machine as **down**, so a newer written
update never silently clears that flag — it is carried across with its own
date and a line saying the newer update does not say either way.


Its own page, laid out the way the department's sheet already is: one block per
machine with **#Ops, Work done / in progress, Next in schedule and Notes**,
grouped by centre so Rolling, FOM, CNC and Multi Punch are visually separate
rather than one long list. The department's standing rows sit at the top
exactly as they do on the sheet, but only **Back Order** is open by default —
it is the one filled in every shift. **Service Orders** and **K1285 Pulls**
fold behind a `＋ Service Orders and K1285 Pulls` link, and open themselves
whenever they already carry something, so nothing written is ever hidden.

Pick the **date** and the **shift** (Day · Afternoon), then **Write** or
**Read**. Midnight is no longer an active shift; old Midnight records remain
readable as historical entries.

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
`3/5`, so what is still blank is obvious without reading any of it. The two
active shift windows and breaks are shown directly on the page:

- **Day 07:00–15:30:** 09:15–09:30, 12:30–13:00, 14:15–14:30.
- **Afternoon 15:30–00:00:** 18:00–18:15, 20:00–20:30, 23:00–23:15.

The header marks the active shift, changes to **Break** during those exact
windows, and reads **Off shift** between midnight and 07:00.

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

The source is exact: **`Shift Update` in the CNC workbook**. The user confirmed
that the live worksheet was renamed from `Shift Update 2`. The similarly named
`Shift Update 2`, `Shift Update (3)` and `Shift Update Old` tabs are never
considered as fallbacks. If `Shift Update` is missing, import reports it missing
instead of selecting something plausible.

This was got wrong twice before: first by reading all four sheets and merging
date/shift labels, which let stale "Afternoon" data beat a current "Day"
block; then by choosing whichever similar tab was visible, which could still
fall back to a hidden archive. Exact source ownership is safer than inference.

A block is laid out as two side-by-side halves (columns 1–7 and 9–15), each
with its own Date/Shift header. Blocks also **stack vertically within that one
sheet**: an empty leftover template sits at the top and the live block starts
at row 57. Both halves are read, every block is found by its own Date header,
and entries merge per machine on one rule: **a block that describes actual work
always beats an empty one**, and a filled-in `#Ops` headcount with no
done/next/notes does not count as work. Only when both are equally (un)filled
does date+shift decide. FMC 1 and FMC 2 appear only on the archived `Shift
Update 2` tab, so the live import reports no update for those machines instead
of borrowing stale data.

**The live block calls the remaining CNC machine `CNC-3`, not `CNC 1`.** Both
map to the same work centre, so the app shows its real entry rather than the
blank `CNC 1` placeholder left in the stale block above. The machine is still
labelled *CNC 1* in the app — rename it in Setup if the floor calls it CNC-3.

Machine names on the sheet that the app has no work centre for are collected
and reported on import rather than dropped in silence — that is how the
department finds out the app is behind the floor again. `CNC-3` is recognised
and maps to the `cnc1` work centre; whether the visible label should say
“CNC 1” or “CNC-3” remains a floor-naming decision and can be changed in Setup.

## Scope boundary

The old ERP-style Daily Schedule implementation — purchasing, inventory,
per-profile material ordering, process-guide and verification workflows —
remains removed. The separate workbook has been reintroduced only as a narrow
read-only source for the **Daily Schedule** and **Projects** pages. Its rows are
stored in `dailyOrders` with `dailyMeta`; they do not create machine tasks,
change routing, or submit anything to purchasing. Manual jobs, history and
shift-update posting remain based on the machine-schedule model. The 8560 rule
is derived directly from FOM 2 and shown on the affected production line; it is
not a purchase request.

The stored data went with it. On first load the app rewrites its saved payload
without the retired fields, so an existing install — and the shared JSON on the
network drive — sheds them rather than carrying them indefinitely. State now
holds `tasks`, `machineMeta`, the keyed overlay maps, `taskHistory`,
`shiftUpdate`, `shiftLogs`, `manualTasks`, `todos`, `staging`, `deletions`,
`people`, `dailyOrders`, `dailyMeta` and local `settings`.

(Shift-update posting has since come back, rebuilt around the machine layout —
see above. An old install's `shiftLogs` were written in a different shape and
are dropped on load rather than half-rendered.)

## Working with no signal

GitHub Pages serves a **modular online app** assembled by `site-build.mjs`.
The initial page loads the production shell and daily work views without
blocking on the engineering drawing libraries. Engineering Lookup is a lazy
route. The 24 MB individual-extrusion image map is fetched and cached
only after somebody opens a profile drawing.

The service worker is **network-first for everything same-origin**, with the
current build's cache as the offline fallback. It warms the operational shell
in the background—including Engineering Lookup—but leaves the 24 MB profile-image map
on demand. A failed network request falls back after four seconds, so a phone
with one bar does not hang indefinitely.

Two things it deliberately leaves alone: **anything cross-origin**, because
that is Supabase and a cached answer there would mean the app quietly
disagreeing with the cloud, and anything that is not a `GET`.

When a new build is deployed the app offers a **Reload** rather than taking
one. `clients.claim()` also fires `controllerchange` on a first visit, as
control passes from nobody to the new worker — reloading there would bounce
someone who has just arrived, so the reload is gated on the user having asked
for it.

Registration is skipped entirely on `file://`, where service workers do not
exist, so the self-contained shared-drive rollback is unaffected.

The header says **offline** when the connection is gone, and that outranks the
sync chip — "synced" next to a dead connection is the one thing it must never
say. Everything still saves locally and goes up when the signal returns.

`test/offline-check.mjs` serves `_site` exactly as Pages does, verifies the
large profile-image map was not downloaded at startup, cuts the network and
reloads. The app must boot, keep its data, accept new entries, open Engineering Lookup
from cache and say it is offline. It also checks cross-origin sync requests
still bypass the worker.

## Deleting, with sync on

Per-record merging has one thing it cannot get right on its own. It reads
"missing on my side" as "the other device knows something I do not" — which is
correct for a record that has not reached you yet, and exactly wrong for one
that was deleted. Clear a rush on the PC and the phone's copy walks straight
back in on the next sync, on both devices.

So a removal is written down rather than performed. The key goes, and a
tombstone carrying the time it went is stored in `state.deletions` under
`` `${map}:${key}` ``. `mergeSnapshot()` merges those like any other record and
then re-applies them, so a deletion beats any copy of the record older than
itself — while a genuinely newer edit still wins, because that is somebody
re-flagging a rush after you cleared it.

This covers every removal in the app: statuses undone, notes cleared, edits
reverted, rushes and back orders cleared, lines put back on their imported
machine, manual jobs, to-dos, shift updates and machine renames. Tombstones are
retained because expiring one would let a sufficiently stale offline device
resurrect the deleted record.

`test/cloud-check.mjs` drives it on two devices: the PC clears a rush the phone
still holds, and both must end up with it gone; then the phone re-flags it and
that must survive. Disabling the tombstone makes the first assertion fail with
`a cleared rush came back on sync` on both devices, which is what the bug
actually looked like.

## Sharing

There are two ways to share, and they use the same per-record merge: `at` says
when a person made the change, while a Lamport `rev` orders it without trusting
device clocks. Two people updating different lines both keep their work;
concurrent edits to one record resolve deterministically.

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
   `tracker_state` table, an explicit Data API grant and three row policies.
3. Paste the **Project URL** and **publishable key** from Settings → API Keys.
   A legacy anon key also works. Never paste a secret or `service_role` key
   into the browser app.
4. Do the same on every phone and PC, with the same **site name**.

### Enabling Photo to To-Do

Photo analysis uses the same Supabase project, but OpenAI credentials stay in a
server-side Edge Function — never paste an OpenAI API key into the browser app.
The source is in `supabase/functions/photo-to-todos/index.ts`.

Create a long department access code and set the three required secrets:

```powershell
supabase secrets set OPENAI_API_KEY="..." `
  PHOTO_TODO_ACCESS_KEY="a-long-random-department-code" `
  PHOTO_TODO_ALLOWED_ORIGINS="https://x-phenomenal-x.github.io"
supabase functions deploy photo-to-todos --no-verify-jwt
```

For a custom Pages domain, use its exact origin (scheme plus host). Multiple
origins are comma-separated. `OPENAI_VISION_MODEL` is optional and defaults to
`gpt-5.6-luna`. The function rejects other browser origins, requires the
department access code before spending model allowance, caps image/request
size, returns `Cache-Control: no-store`, and never writes to the tracker table.

On first use each device asks for the department access code. That code is kept
in a separate device-only localStorage entry, `bv.cutting.photo-todo.access.v1`;
it is not part of either synced cloud document. The public Supabase publishable
key is still sent as the gateway `apikey`; secret and `service_role` keys never
belong in the PWA.

The snapshot is pushed as **two documents, not one**:

| | what | size on the real data | pushed |
|---|---|---|---|
| `base` | the imported workbooks | ~1.6 MB | only on re-import |
| `work` | statuses, notes, edits, rush, shortages, assignments, parked decisions, shift updates, history | starts at a few KB and grows with work | debounced, on every change |

Together that would mean a phone uploading the workbooks every time somebody
taps Done. Split, a tap sends only the work document. `test/cloud-check.mjs` asserts the
`work` document stays at least five times smaller than `base` and never carries
the task list.

Pulls poll every 30 seconds while the tab is visible, and immediately when you
come back to the app — which on a phone is exactly when its copy is most likely
to be stale.

**The trade-off, plainly:** the explicit Data API grant and policies let anyone
holding the address and publishable (or legacy anon) key read and write the
department's data. There is no login. Keep the configuration to the department,
the same way the network share is kept to the department. If that is not
acceptable, the shared file gives up phones and keeps everything inside the
building.

Without either, the app still works fully, storing data in that browser.
Export / Import moves it between machines.

### Putting it on a URL

`.github/workflows/pages.yml` verifies and publishes the modular `_site`
artifact to GitHub Pages on every push to the repository's default branch.
The standalone file is still rebuilt and tested as the rollback artifact. Enable Pages once
in **Settings → Pages → Source: GitHub
Actions**; the workflow will not do anything until you do. `manifest.webmanifest`
means **Add to Home Screen** on a phone opens it like an app.

## Tests

```
npm ci                             # installs the pinned build and test tools
npm test                           # complete release gate, including build and offline/standalone checks
```

The gate generates sanitized workbook fixtures in memory, so it is safe for CI
and does not depend on a developer's upload directory. To validate a release
against the real schedules, set `BV_ROLLING_WORKBOOK` and `BV_CNC_WORKBOOK` to
their local paths before running it. See [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md)
for the complete release and operating checklist.

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

### Visual QA

`test/visual-qa.mjs` is the one that keeps the interface honest. It loads
`test/fixture.mjs` — a **sanitized** development fixture, not the real
workbooks — and walks every page at 390, 768, 1024, 1280 and 1440 in both
light and dark, capturing the phone and desktop widths to
`test/screens/qa/`.

The fixture is deterministic and built to be awkward on purpose: 780 lines
across all ten machines, every state the interface has to render (running,
overdue, rush with and without an owner, sheet-flagged and hand-flagged and
hand-*cleared* back orders, edited, moved between machines, machine down,
completed), and text long enough to break a layout — a project called
"Bayfront Residences at Old Mill Crossing — Phase 3 Podium & Amenity Level",
a floor spanning six levels, an assignee named Krystyna Wojciechowska.

What it asserts, rather than eyeballs:

- **No horizontal overflow** at any of the five widths.
- **Tap targets** — nothing under 44px on a phone, 32px anywhere else. It
  measures the *label* around a checkbox, since that is what gets tapped.
- **Contrast** — it computes the real rendered ratio for every state-carrying
  pair against its actual background and fails under WCAG AA.
- **Status is never colour alone** — every badge, stat, segment and rail must
  also carry words or an icon.
- **Keyboard focus is visible** — it focuses a control and asserts the
  box-shadow actually changed.
- **The phone header stays under 96px**, and **no nav tab is cut off at
  1280px or wider**.
- **Long text wraps** rather than spilling out of its band.
- **Every control has an accessible name.**
- **The bulk bar clears the safe area** and the **dialog footer is never
  below the fold** on a phone.
- **Reduced motion** disables every sampled transition and animation.
- **200% zoom**, emulated as a 640px layout, which is what a 1280px monitor
  at 200% actually is.

Three real defects came out of writing it: the page-in animation put a
`transform` on `.centre`, which made it the containing block for the fixed
bulk-action bar and threw it to the bottom of a 9,000px document for 180ms
after *every* re-render; the focus ring was being silently overridden by every
control that set its own `box-shadow`; and the Back Orders nav badge was
counting assignees instead of shortages.

## Interface notes

The next app-wide hierarchy and workflow upgrade is specified in
[DESIGN_UPDATE_PLAN.md](DESIGN_UPDATE_PLAN.md). It starts with selecting a
grounded visual direction before any production styling changes.

- Everything is keyboard- and pointer-accessible; the segmented control uses
  `aria-pressed`, groups use `aria-expanded`. **Keyboard focus draws a visible
  ring** on every interactive element via `:focus-visible`, so it never shows
  for pointer users.
- **Contrast meets WCAG AA**, measured rather than assumed — `test/visual-qa.mjs`
  computes every state-carrying pair against its real background. `--ink-3`
  carries most of the secondary text on the page and is set against the
  *darkest* surface it lands on, not against white: 5.4 / 5.2 / 4.8 across
  panel, panel-2 and the page background.
- **Filled semantic colours flip their ink.** In light mode the five semantics
  take white at 5.3:1 or better; in dark mode they are deliberately light and
  white on them lands around 2.2:1. One token, `--on-fill`, flips to near-black
  in dark, which is why the purple "Running now" header is legible in both.
- **Sizes come off one ladder.** Type (`--t-xs` … `--t-2xl`), space (`--s1` …
  `--s7`), radius and control heights are tokens, so a panel on Rush and a
  panel on Setup are the same object. Body text is 15px: these screens are
  wall-mounted or sat back from.
- **Controls are sized for gloves.** `--ctl` 40px ordinarily, `--ctl-lg` 48px
  for the actions taken all shift (the Done button on a running line), `--tap`
  44px as the floor for anything on a phone. Checkboxes stay 22px but sit
  inside a 44px label.
- **Elevation is tokenised** (`--shadow-1/2/3` plus `--sheen`) because dark
  mode cannot reuse light-mode shadows: a black shadow on a near-black surface
  is invisible, which is why the dark theme used to read completely flat. Dark
  adds a hairline top highlight instead.
- Numbers use `font-variant-numeric: tabular-nums` globally — quantities down a
  column and counts across the stat strip are read against each other.
- Icons are inline SVG — nothing is fetched, so the app still runs from a
  network share with no internet. IBM Plex Sans and IBM Plex Mono are bundled
  into that file, so typography is consistent without a runtime font request.
- Transitions are short (100–180ms) and are disabled entirely under
  `prefers-reduced-motion`. Buttons depress on `:active`: with gloves on, that
  is most of the confirmation you get that a tap landed.
- Light and dark both ship; the palette is defined once as tokens and only the
  values change under `prefers-color-scheme: dark`.
- **Navigation is two groups, not one undifferentiated row.** The four production
  centres read as a solid segmented control; the six department tools sit past a
  divider, quieter, because they are visited rather than lived in. Rush and
  Back Orders carry an outstanding count on the tab, so nobody has to open a
  page to learn there is nothing on it.
- **On a phone the header is two rows and 95px.** Row one is identity only —
  brand, shift, sync — and carries no tap target, because a third 44px control
  there is what put the old header at 121px. Row two is the centre scroller
  with the name picker pinned beside it. At 1280px and below the tools fall
  back to short labels (`B/O`, `Shift`) rather than letting Setup slide off
  the end of the nav.
- **The machine header clears the app header** rather than sliding under it:
  `app.js` measures the header into `--hdr-h` on every render, and the sticky
  centre header offsets by it.
- **Printing uses purpose-built paper documents.** Machine schedules, saved or
  draft shift updates, assembly drawings/component maps and extrusion profile
  records each have a dedicated action and Letter-size layout. The interactive
  nav and controls never enter the document; rows and cards avoid page breaks.
