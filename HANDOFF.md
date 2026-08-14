# Handoff — BV Glazing Cutting Tracker

Written to be pasted into another assistant (ChatGPT or otherwise) as context,
or read by a person picking this up cold. Everything here is verified against
the real workbooks, not assumed.

**Repo:** `X-phenomenal-X/Fabrication-Production-Tracker`
**Default branch:** `claude/dept-operations-dashboard-v9un45` (there is no
`main` — that branch *is* the default; don't try to merge into `main`)
**Live:** https://x-phenomenal-x.github.io/Fabrication-Production-Tracker/

---

## 1. What this is

A production tracker for the **Cutting department at BV Glazing Systems**
(window/door/curtainwall fabrication). It replaces editing Status cells in two
Excel workbooks by hand.

It is a **zero-dependency vanilla-JS app**. No framework, no runtime packages.
This is a hard constraint, not a style preference:

- It must run from a **network share with no internet** by double-clicking one
  file (`Cutting-Tracker.html`, built by `node build.mjs`, ~180 KB, everything
  inlined). That rules out CDNs, external fonts, and remote anything.
- Which is why there is a **hand-rolled XLSX reader** (`js/xlsx.js`, 246 lines)
  built on `DecompressionStream('deflate-raw')` + `DOMParser`. Do not replace it
  with SheetJS or similar.
- Icons are inline SVG (`ICON_PATHS` in `js/ui.js`). Nothing is fetched.

Same source also deploys to GitHub Pages so it works on phones (see §6).

---

## 2. The domain knowledge — read this before touching the importer

This is the part that took real investigation. Getting it wrong produces an app
that looks fine and is quietly wrong.

### The two workbooks are the only source of truth

| Workbook | Sheets read | Feeds |
|---|---|---|
| `Rolling_Schedule_2026.xlsx` | `Auto`, `Manual`, `Complete` | Rolling (Auto/Etas), Rolling (Manual/Iota) |
| `CNC_Schedule_Rev_E.xlsx` | `FOM1`, `FOM2`, `FOM3`, `MultiPunch & SAW`, `CNC & FMC`, `Shift Update 2` | FOM 1–3, Multi Punch, the CNC/FMC queue, and the shift update |

The Daily Schedule workbook was **deliberately dropped** — an earlier version
tracked it and the scope was reset. Don't reintroduce it.

### Machines: CNC 2 and CNC 3 are gone, FMC 1 and FMC 2 replaced them

Current floor: **CNC 1, FMC 1, FMC 2** (plus Rolling ×2, FOM ×3, Multi Punch).
Confirmed by the user directly.

### The `CNC & FMC` sheet has NO machine column

It is one flat list: `WO# · PROJECT · FL · Product · QTY · B/O · B/O Stat ·
Cutting Date · Status`. There is **no per-machine CNC schedule anywhere in
either workbook**. (`CNC Daily` has a Work Center column but is dated Sept 27th;
`Machine Schedule` is from Jan 29th — both long stale.)

So it imports into a shared **`cncfmc` "Unassigned" queue**, and lines are put on
CNC 1 / FMC 1 / FMC 2 **by hand** in the app. `assignableIn()` / `hasQueue()` in
`js/machines.js` gate this; only the CNC group has a queue.

### FMC appears in exactly ONE place in either workbook

`Shift Update 2`, in a block starting **row 57**. That sheet contains *two*
vertically stacked blocks: an empty leftover Day template at the top, and the
real one from row 57 down.

**The sheet is chosen by Excel visibility, not by name.** Only `Shift Update 2`
is visible; `Shift Update`, `Shift Update (3)` and `Shift Update Old` are
hidden, as are 58 of the workbook's 73 sheets. Hiding a tab is how this
department archives it, so that is the signal — and it survives them renaming
or reorganising. `pickShiftUpdate()` in `js/import-machines.js`; `readXlsx`
exposes `hiddenSheets`. **Do not hardcode a sheet name here** — that has been
got wrong twice (see §9, trap 3).

Also: the live block calls the remaining CNC machine **`CNC-3`**, not `CNC 1`.
`SU_MACHINE` maps both to `cnc1`; the content-first merge then picks the one
that actually says something over the blank `CNC 1` placeholder in the stale
block at the top of the same sheet.

### Shift-update block layout

Two side-by-side halves per block (columns **1–7** and **9–15**), each with its
own `Date`/`Shift` header row:

```
Machine | #Ops | (bullet) | Work Done/In Progress | (bullet) | Next in Schedule | NOTES
```

A machine's entry runs from its name row until the next name row. Blocks are
found by scanning for a row whose first column reads `Date` — **not** a fixed
row number, because they stack.

`#Ops` is usually a headcount but is sometimes the literal word `DOWN`.

### Other verified data quirks

- **The `B/O` column counts BARS, not pieces**, and FOM 2 / FOM 3 write it as
  text (`"3 BARS"`, `"1 BAR MISSING"`). It is kept raw as `boRaw` and shown as
  context beside the user-entered piece count, never parsed as a piece count.
- **`IP BO` means both** "in progress" *and* "short of material". Reading it as
  a single status loses the back-order half on 67 open lines. Back order is
  parsed into its own flag (`readsBackOrder()`).
- **Excel date serials leak into quantity columns.** W/O 32127 had `46206`
  (a July 2026 date serial) in three quantity columns. Rejected by refusing
  40000–60000 integers and values > qty×100.
- **The `Cutting` and `CNC` view sheets are fully broken** — every VLOOKUP
  column returns `#N/A`. Not used.
- Work orders are **not** numeric-only. `MU2026-012`, `DAN 509`, `29038so`,
  `PARCEL29-SWD`, `TRIMS`, `PREP` are all legitimate. An early numeric-only rule
  discarded 274 real orders.
- Shifts: **Day 07:00–15:00, Afternoon 15:00–23:00, Midnight 23:00–07:00**
  (Midnight crosses into the next day). Afternoon is full crew; **Midnight runs
  only 3 operators**.
- **Panels belong to another department. Louvres belong to Cutting.**
- 8560 vents need hinges (rule noted by the user; not currently implemented).

### Current import numbers (sanity check after any importer change)

```
Rolling: 1,799 lines   CNC: 2,118 lines   Total: 3,917 tasks, 738 open
Rolling(Auto) 191 open · Rolling(Man) 69 · FOM1 100 · FOM2 184 · FOM3 51
CNC/FMC queue 81 · Multi Punch 62 · back-order flag on 67 open lines · 202 dies
Shift update resolves 9 machines, all from Shift Update 2
```

---

## 3. Architecture and its invariants

### The overlay pattern — the single most important invariant

Imported sheet data is **never mutated**. Everything a person does is stored as a
separate keyed record layered on top:

```
state.taskStatus[key]  { status, at, by }
state.taskNote[key]    { text, at, by }
state.taskEdit[key]    { fields:{…}, at, by }   // corrections to sheet values
state.backOrder[key]   { flagged, qty, assignee, note, at, by }
state.rush[key]        { on, needBy, assignee, reason, at, by }
state.taskAssign[key]  { machine, at, by }      // which machine took a queued line
```

**The key is `` `${machine}|${wo}|${die}` `` built from the *imported* values,
never the edited ones** (`taskStatusKey()` in `js/model.js`, which reads
`t.origin || t`).

Why this matters, concretely:
- Sheet **row numbers shift on every re-import** — keying on row silently
  orphans every status update the next time a workbook is reloaded.
- Editing a die must not move the line's status/note/history to a new key.
- **Assigning a queued CNC line to FMC 2 does NOT change its key** — it stays
  `cncfmc|…`. `test/app-check.mjs` asserts this explicitly, because the
  alternative silently orphans everything attached to that line.

### Tri-state back-order flag

`backOrder.flagged` is deliberately `undefined | true | false`:
`undefined` follows the workbook, `true` flags a line the sheet doesn't,
`false` records that a shortage the sheet **still reports** is resolved. Without
the third state there is no way to close out a shortage the workbook keeps
asserting.

### Sync: per-record merge, never whole-file last-write-wins

Every record carries an `at` timestamp; the newer one wins **per record**
(`mergeRecords()` in `js/store.js`). Two people editing different lines both
keep their work. `taskHistory` is append-only, merged by entry `id`.

Two transports, same merge:
- **Shared file** (File System Access API) — network drive, no internet, no
  account. Chrome/Edge only, and **no phone browser has this API**.
- **Cloud** (`js/cloud.js`, Supabase REST over plain HTTPS, no SDK) — this is
  what makes phones work.

The cloud snapshot is split into **two documents**, which matters a lot:

| part | contents | size | pushed |
|---|---|---|---|
| `base` | `tasks`, `machineMeta`, `shiftUpdate` | **~1.6 MB** | only on re-import |
| `work` | statuses, notes, edits, rush, back orders, assignments, shift logs, history | **~1 KB** | debounced, every change |

Together it would mean a phone uploading 1.6 MB every time somebody taps Done.

### Rendering

- Vanilla `el()` DOM helper in `js/ui.js`. No virtual DOM.
- **All view-triggered redraws go through `scheduleRender()`** (a
  `requestAnimationFrame` defer in `js/app.js`). Tearing down the DOM
  synchronously inside a `blur`/`change` handler throws
  `Failed to execute 'removeChild'`. Never call `render()` directly from a view.
- `root.replaceChildren(...)`, not a `clear()` loop, for the same reason.

---

## 4. File map

```
index.html                 shell; also the build template
build.mjs                  esbuild → Cutting-Tracker.html (inlines CSS+JS)
manifest.webmanifest       Add-to-Home-Screen on phones
.github/workflows/pages.yml publishes the built file to GitHub Pages

css/app.css          (818)  design tokens + every component
js/app.js            (123)  shell: TABS, header, render loop
js/ui.js             (231)  el(), icons, chips, toasts, modal, fmt*
js/xlsx.js           (246)  dependency-free XLSX reader
js/import-machines.js(404)  workbook parsers + shift-update parser
js/machines.js       (59)   machine registry (the 10 machines + standing rows)
js/shifts.js         (17)   shift windows
js/store.js          (729)  state, persistence, shared file, cloud orchestration
js/cloud.js          (177)  Supabase REST transport (dumb; no app knowledge)
js/model.js          (374)  derived views: queues, grouping, resolve*, runningNow
js/views/centre.js   (653)  THE work-centre page (all 4 centres are this file)
js/views/rush.js     (244)  rush dialog + Rush page
js/views/backorders.js(215) back-order dialog + Back Orders page
js/views/shiftupdate.js(445) Shift Update write/read page
js/views/data.js     (384)  Setup: import, shared file, cloud, people, backup
```

`js/views/centre.js` is parameterised by centre — `makeCentreView('FOM')`.
All four centre pages are that one file with different data.

---

## 5. Commands

```bash
npm install                  # once (esbuild + playwright)
npm run serve                # http://localhost:8000  (modules need a server)
node build.mjs               # regenerate Cutting-Tracker.html

node test/machines-check.mjs   # parses both workbooks, prints what came out
node test/app-check.mjs        # full E2E walk of every page  (~2 min)
node test/cloud-check.mjs      # two devices vs a mock cloud — do they converge?
node build.mjs && node test/standalone-check.mjs   # same over file://
```

**All four must pass before pushing.** They run headless Chromium from
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`; adjust that path
elsewhere. Sample workbooks live in
`/root/.claude/uploads/042835a0-704b-5601-bc20-4ed82d27578f/` — a fresh
environment won't have them and those tests will need new sample files.

`test/cloud-check.mjs` is worth understanding: there is no Supabase to reach
from a test, so it stands up a **mock speaking the same PostgREST shapes** —
the `part=in.()` filter, the `on_conflict` upsert with
`Prefer: resolution=merge-duplicates`, and the CORS preflight the `apikey` /
`Prefer` headers force a browser to send. It then drives two browser contexts
with separate localStorage as two people and asserts they converge.

---

## 6. Live state as of this handoff

- **Pages is enabled and deploying.** The workflow triggers on any push and
  publishes only when the ref is the repo's default branch.
- **Cloud sync is configured** on at least the user's phone, against a Supabase
  project, site name `Cutting Dept.`
- **Credentials are NOT in this repo and must not be.** The repo is **public**.
  The Supabase URL + anon key live in each device's `localStorage` under
  `bv.cutting.cloud`, entered via Setup → Sync across devices.
  ⚠️ The anon key was pasted into a chat transcript during setup — it is worth
  rotating in Supabase (Settings → API) and re-entering on each device.
- **No schedule data has been imported into the live app yet.** The workbooks
  need to be dragged into Setup on any one synced device; that pushes `base` to
  the cloud and every other device picks it up.

The Supabase table (created once via the SQL in Setup → Show setup SQL):

```sql
create table if not exists tracker_state (
  site text not null, part text not null,
  data jsonb not null, updated_at timestamptz not null default now(),
  primary key (site, part));
alter table tracker_state enable row level security;
create policy "tracker read"   on tracker_state for select using (true);
create policy "tracker insert" on tracker_state for insert with check (true);
create policy "tracker update" on tracker_state for update using (true) with check (true);
```

Those policies mean **anyone with the URL + anon key can read and write the
data. There is no login.** That is the accepted trade for not running accounts;
it's documented in the README and surfaced in the SQL dialog.

---

## 7. Conventions this codebase follows

- **Comments explain *why*, never *what*.** Most comments here record a decision
  and the evidence behind it. Match that.
- **Commit messages are long and explain the reasoning**, including what was
  rejected and why. `git log` is the design record.
- Never widen scope silently. The app was deliberately narrowed once already.
- When the data is ambiguous, **surface it rather than guess** — e.g.
  unrecognised machine names on the shift-update sheet are collected and
  reported on import instead of being dropped.
- Prefer showing nothing over showing something plausible-but-wrong.

---

## 8. Open work

### The visual upgrade — DONE (commit `25cd719`)

A pass over the whole interface has landed. Four of the changes were
corrections rather than taste, and are worth not regressing:

- **`--ink-3` contrast.** It was 2.9:1 on white — below WCAG AA — and carries
  most secondary text (stat labels, dates, counts). Now 4.8:1 light / 5.1:1
  dark. If you change this token, re-check it.
- **Elevation is tokenised** (`--shadow-1/2/3` + `--sheen`) because dark mode
  cannot reuse light shadows; the dark theme previously had no depth at all.
- **`:focus-visible` ring** on everything interactive — there was none before
  outside form fields.
- **Phone header** collapses to one row via `order` on `nav.tabs` plus hiding
  `.brand small`, reclaiming ~100px.

Plus a print stylesheet, tabular numerals globally, capped annotation bands,
translucent sticky headers, and `:active` depress on buttons.

Constraints that bound any *further* redesign:
- **No web fonts, no external assets.** System font stack only.
- Must stay legible **on a shop floor**: gloved taps, glare, phones and desk
  monitors. Touch targets stay generous; the 3-way status control must not
  shrink.
- **Dark mode must keep working** — tokens are defined once and only values
  change under `prefers-color-scheme: dark`.
- Transitions stay short (120–180 ms) and are disabled under
  `prefers-reduced-motion`.
- Every `.centre` page shares one stylesheet; changes hit all four centres,
  Rush, Back Orders and Shift Update at once.
- **Do not rename selectors.** The four test suites assert on structure
  (`.cstat i`, `.seg-btn[aria-pressed]`, `.nowrun-count`, `.line`, `.dgroup-*`).
  CSS-only changes are safe; class renames are not.

### Open question — is the CNC machine called CNC 1 or CNC-3?

The live shift-update block writes **`CNC-3`**. `SU_MACHINE` now maps it to
`cnc1`, so the data flows correctly, but the app still *labels* the machine
"CNC 1" — the user's own answer when asked. If the floor calls it CNC-3,
change the label in `js/machines.js` (or just rename it in Setup, which is
stored in `machineConfig` and shared). Cosmetic only; the data is right either
way.

### Smaller known gaps

- The 8560-vents-need-hinges rule was mentioned by the user but never built.
- Service orders are added by hand in the workbook; the app has no way to add
  a line that isn't in a sheet.
- `test/*.mjs` depend on absolute paths to sample workbooks (see §5).

---

## 9. Traps that already bit — don't repeat these

1. **Direct `render()` from inside a view handler** → `removeChild` throws when
   an input has focus. Always `scheduleRender()`.
2. **Keying overlays on anything but the imported wo+die** → silent data loss on
   re-import or on editing a die.
3. **Picking the shift-update sheet by name.** Two separate bugs came out of
   this. First, reading all four and merging by date+shift label — "Afternoon"
   is not automatically later than "Day" when they are on *different* sheets,
   so stale Afternoon data beat the live Day block for every machine. Then,
   pinning to `Shift Update 2`, which only looked right because that is the
   visible tab today, and still left `cnc1` empty because the live block calls
   it `CNC-3`. The rule that holds is **read the visible tab**.
4. **Counting a filled-in `#Ops` as "content."** A crew number with no
   done/next/notes is still an empty block; treating it as content let a blank
   template row beat a row with real work on it.
5. **Missing closing parens in nested `el()` calls** — recurred ~7 times. After
   any nested-`el` edit, run `node --check` on a copy: `cp f.js /tmp/c.mjs &&
   node --check /tmp/c.mjs`.
6. **Playwright locators built on text that the click changes** (e.g.
   `.chip` with `hasText: 'Not started'`) silently start matching a different
   row. Locate on stable W/O + die instead.
7. **Test assumptions about machine labels** — one test renames a machine, so
   later steps can't assume the original title. Wait on the nav, not the title.
8. `npm ci` fails here — `package-lock.json` is gitignored. CI uses
   `npm install --ignore-scripts`.

---

## 10. Suggested prompt for continuing elsewhere

> I'm continuing work on a production tracker for a window-fabrication cutting
> department. It's a zero-dependency vanilla-JS app (no framework, no runtime
> packages) that must run offline from a single self-contained HTML file, and
> also deploys to GitHub Pages for phone use. The handoff document below covers
> the architecture, the verified quirks of the source Excel workbooks, and the
> invariants I must not break. Read it fully before proposing changes, and ask
> before altering anything under "Open work".
>
> [paste this file]
