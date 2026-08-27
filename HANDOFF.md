# Handoff — BV Glazing Cutting Tracker

Written to be pasted into another assistant (ChatGPT or otherwise) as context,
or read by a person picking this up cold. Everything here is verified against
the real workbooks, not assumed.

**Repo:** `X-phenomenal-X/Fabrication-Production-Tracker` — **public**
**Default branch:** `claude/dept-operations-dashboard-v9un45` (there is no
`main` — that branch *is* the default; don't try to merge into `main`)
**Live:** https://x-phenomenal-x.github.io/Fabrication-Production-Tracker/
**Deploy:** every push to the default branch builds and publishes to Pages
automatically. There is no separate deploy step.
**Reviewed:** 14 Aug 2026. This file is versioned with the code; use
`git log -1 --oneline` for the exact revision rather than trusting a copied SHA.

---

## 1. What this is

A production tracker for the **Cutting department at BV Glazing Systems**
(window/door/curtainwall fabrication). It replaces editing Status cells in two
Excel workbooks by hand.

It is a **zero-dependency vanilla-JS app**. No framework, no runtime packages.
The hosted app is the normal production path; a self-contained file remains
the emergency/shared-drive path:

- It must run from a **network share with no internet** by double-clicking one
  file (`Cutting-Tracker.html`, built by `node build.mjs`, with every module and
  engineering drawing inlined). That rules out CDNs, external fonts, and
  runtime dependencies.
- Which is why there is a **hand-rolled XLSX reader** (`js/xlsx.js`, 246 lines)
  built on `DecompressionStream('deflate-raw')` + `DOMParser`. Do not replace it
  with SheetJS or similar.
- Icons are inline SVG (`ICON_PATHS` in `js/ui.js`). Nothing is fetched.

The same source deploys as a modular online-first PWA to GitHub Pages so phones
do not download the entire standalone artifact on every launch (see §6).

---

## 2. The domain knowledge — read this before touching the importer

This is the part that took real investigation. Getting it wrong produces an app
that looks fine and is quietly wrong.

### The two workbooks are the only source of truth

| Workbook | Sheets read | Feeds |
|---|---|---|
| `Rolling_Schedule_2026.xlsx` | `Auto`, `Manual`, `Complete` | Rolling (Auto/Etas), Rolling (Manual/Iota) |
| `CNC_Schedule_Rev_E.xlsx` | `FOM1`, `FOM2`, `FOM3`, `MultiPunch & SAW`, `CNC & FMC`, `Shift Update` | FOM 1–3, Multi Punch, the CNC/FMC queue, and the shift update |

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

`Shift Update`, in a block starting **row 57**. That sheet contains *two*
vertically stacked blocks: an empty leftover Day template at the top, and the
real one from row 57 down.

**Only the exact `Shift Update` sheet is read.** The user confirmed that the
live worksheet was renamed from `Shift Update 2`. `Shift Update 2`,
`Shift Update (3)` and `Shift Update Old` are never fallbacks, visible or
hidden. If the live sheet is missing, the import reports `Shift Update` missing
rather than showing plausible-but-stale data (see §9, trap 3).

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
Shift update resolves 9 machines, all from Shift Update

Of the 202 distinct die strings, 164 are sub-assemblies the section book knows;
the rest are text like "Door sash", "Mock UP", "RUSH order".
Routing SOP: widths 1,537 · heights 702 · vents 553 · unsplit 429 · 696 outside
```

---

## 3. Architecture and its invariants

### The overlay pattern — the single most important invariant

Imported sheet data is **never mutated**. Everything a person does is stored as a
separate keyed record layered on top:

```
state.taskStatus[key]  { status, at, by, rev }
state.taskNote[key]    { text, at, by, rev }
state.taskEdit[key]    { fields:{…}, at, by, rev }   // corrections to sheet values
state.backOrder[key]   { flagged, qty, assignee, note, at, by, rev }
state.rush[key]        { on, needBy, assignee, reason, at, by, rev }
state.taskAssign[key]  { machine, at, by, rev }      // which machine took a queued line
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

Every new record carries an `at` timestamp for people and a logical `rev` for
ordering. The higher revision wins **per record** (`mergeRecords()` in
`js/store.js`), so a phone with the wrong clock cannot overwrite a genuinely
newer edit. Concurrent edits converge deterministically. Legacy records without
`rev` use timestamps until that record is edited once. Two people editing
different lines both keep their work. `taskHistory` is append-only, merged by
entry `id`.

Two transports, same merge:
- **Shared file** (File System Access API) — network drive, no internet, no
  account. Chrome/Edge only, and **no phone browser has this API**.
- **Cloud** (`js/cloud.js`, Supabase REST over plain HTTPS, no SDK) — this is
  what makes phones work.

The cloud snapshot is split into **two documents**, which matters a lot:

| part | contents | size | pushed |
|---|---|---|---|
| `base` | `tasks`, `machineMeta`, `shiftUpdate` | **~1.6 MB** | only on re-import |
| `work` | statuses, notes, edits, rush, back orders, assignments, shift logs, history | starts at a few KB and grows with recorded work | debounced, every change |

Together it would mean a phone uploading 1.6 MB every time somebody taps Done.

### Deletions need tombstones

Per-record merge reads a *missing* record as "the other device knows less", so a
plain delete comes straight back from whichever device still has it.
`state.deletions` records `key → { at, by, rev }`; a newer tombstone wins.
Tombstones are retained: expiring them would let a device that stayed offline
past the cutoff resurrect deleted work. Anything added to `DELETABLE` in
`js/store.js` must go through `forget()`, never `delete state.x[key]`.

### Routing: the SOP outranks the learned habit

`js/routing.js` encodes **SOP-WW-CUT-008 v8.0** (Window Wall & Vents Material
Flow). `suggestedMachine()` in `js/model.js` asks it first and only falls back
to counted history when the SOP does not cover the line. Three things about it
that are easy to get wrong and are load-bearing:

- **High thermal is a *widths* question and only a widths question.** The
  flowchart asks it after the widths/heights split. `SA80-106HT` is a *vertical*
  male frame — a height, bound for the saw. Using the HT suffix to split
  auto-rolling material routes about a third of it to FOM 2 wrongly.
- **The SOP covers window wall (8000 series) and vents (8500) only.** The same
  rolling machines run sliding door, flashing and door sash, and FOM 1 is the
  8900-and-screen machine. 696 of 3,917 lines are outside it and `routeFor()`
  returns `null` for them rather than inventing a route.
- **The tracks are read off the machine the workbook has the line on**, because
  no column states them. Where that is a guess the UI says which guess and why.

The other half of the SOP is **paperwork** — which document set travels with the
job and whose office it is in. That is on every step of the route panel.

### Rendering

- Vanilla `el()` DOM helper in `js/ui.js`. No virtual DOM.
- **The header is rebuilt on every render**, so anything stateful in it must be
  restored afterwards. The nav scroller is: `settleNav()` in `js/app.js` carries
  `scrollLeft` across rebuilds and re-centres the active tab only when the tab
  *changes*. Centring on every render drags the row out from under a thumb.
- **All view-triggered redraws go through `scheduleRender()`** (a
  `requestAnimationFrame` defer in `js/app.js`). Tearing down the DOM
  synchronously inside a `blur`/`change` handler throws
  `Failed to execute 'removeChild'`. Never call `render()` directly from a view.
- `root.replaceChildren(...)`, not a `clear()` loop, for the same reason.

---

## 4. File map

```
index.html                  shell; also the build template
build.mjs                   esbuild → Cutting-Tracker.html (inlines CSS+JS)
site-build.mjs              assembles modular _site + stamped precache list
sw.js                       online-first worker + modular offline fallback
manifest.webmanifest        Add-to-Home-Screen on phones
.github/workflows/pages.yml verifies and publishes modular _site

css/app.css          (1963) design tokens + every component
js/app.js            (285)  shell: TABS, header, nav scroller, render loop
js/ui.js             (234)  el(), icons, chips, toasts, modal, fmt*
js/xlsx.js           (252)  dependency-free XLSX reader
js/import-machines.js(461)  workbook parsers + shift-update parser
js/machines.js       (80)   machine registry (the 10 machines + standing rows)
js/shifts.js         (17)   shift windows
js/store.js          (937)  state, persistence, shared file, cloud, tombstones
js/cloud.js          (177)  Supabase REST transport (dumb; no app knowledge)
js/model.js          (708)  derived views: queues, grouping, resolve*, runningNow
js/offline.js        (84)   service-worker registration + update prompt
js/routing.js        (299)  SOP-WW-CUT-008 encoded — see §3
js/dies.js                  section-book lookup, recovery audit, both directions
js/die-drawings.js          drawing helpers, loaded behind Engineering Lookup
js/extrusions.js            reviewed profile search and series index
js/subassemblies.js  (gen)  997 sub-assemblies, 84 KB — generated
js/drawings.js       (gen)  883 die pictures, 3.3 MB — generated
js/views/centre.js   (819)  THE work-centre page (all 4 centres are this file)
js/views/today.js    (235)  Today: to-dos + the cross-machine board
js/views/staging.js  (190)  Staging — an overlay on the rolling lines
js/views/rush.js     (250)  rush dialog + Rush page
js/views/backorders.js(233) back-order dialog + Back Orders page
js/views/shiftupdate.js(548) Shift Update write/read page
js/views/dies.js            unified assembly/profile Engineering Lookup
js/views/die-launcher.js    lightweight lazy entry from production rows
js/views/routing.js  (156)  per-line routing + paperwork, and the rules
js/views/manual.js   (138)  add a job that is in no workbook
js/views/data.js     (485)  Setup: import, shared file, cloud, people, backup

tools/parse-subassemblies.mjs   section-book Listings → js/subassemblies.js
tools/extract-drawings.py       drawing PDFs → js/drawings.js
tools/extract-listing-thumbs.py Listing thumbnails → thumbs.json (gap filler)
```

`js/views/centre.js` is parameterised by centre — `makeCentreView('FOM')`.
All four centre pages are that one file with different data.

**Nine nav pages:** Rolling · FOM · CNC & FMC · Multi Punch · Today · Staging ·
Rush · Back Orders · Shift Update. Setup is the header gear, not a tenth tab —
the nav had already run out of width.

`Cutting-Tracker.html` is deliberately large because it contains the full
24 MB extrusion image library as well as every module and font. It remains the
single-file rollback; GitHub Pages must publish `_site`, not that file.

---

## 5. Commands

```bash
npm ci                       # once (pinned esbuild + playwright)
npm run serve                # http://localhost:8000  (modules need a server)
npm run build                # regenerate Cutting-Tracker.html
npm run build:site           # assemble the modular hosted artifact in _site
npm test                     # the complete release gate below

node test/machines-check.mjs   # parses both workbooks, prints what came out
node test/app-check.mjs        # full E2E walk of every page  (~2 min)
node test/cloud-check.mjs      # two devices vs a mock cloud — do they converge?
node test/routing-check.mjs    # every leaf of the routing SOP, then real data
node site-build.mjs && node test/offline-check.mjs # modular offline/reconnect
node test/visual-qa.mjs        # 10 screens × 5 widths × 2 themes  (~6 min)
node build.mjs && node test/standalone-check.mjs   # same over file://
```

`npm test` runs every check before Pages can publish. Tests find Playwright's
installed Chromium automatically, or use `PLAYWRIGHT_CHROMIUM_PATH`. Public CI
generates sanitized XLSX schedules with every required sheet and edge case;
to run the private real-count assertions, set `BV_ROLLING_WORKBOOK` and
`BV_CNC_WORKBOOK` to the two real files. No customer data is committed.

`test/visual-qa.mjs` is the one to run after any CSS change. It does not compare
screenshots — it **measures the rendered page**: real contrast ratios on actual
foreground/background pairs, tap-target boxes, horizontal overflow, whether the
active nav tab is inside the nav, accessible names, the 96px phone-header
budget, focus visibility, and that nothing conveys status by colour alone. It
uses `test/fixture.mjs`, a **sanitized** dataset — no real work orders or
customer names — with deliberately awkward text to catch wrapping bugs.

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
- **Cloud sync is configured and confirmed working** on the user's phone,
  against a Supabase project, site name `Cutting Dept.`
- **Credentials are NOT in this repo and must not be.** The repo is **public**.
  The Supabase URL + publishable (or legacy anon) key lives in each device's
  `localStorage` under `bv.cutting.cloud`, entered via Setup → Sync across devices.
  ⚠️ The legacy anon key was pasted into a chat transcript during setup — it is
  worth replacing with a publishable key in Supabase (Settings → API Keys) and
  re-entering it on each device. Never use a secret or service_role key.
- **Real work orders and customer names must never be committed.** The test
  fixture is sanitized for exactly this reason; sample workbooks stay outside
  the repo.
- **Whether the schedules have been imported into the live app is unconfirmed.**
  Dragging both workbooks into Setup on any one synced device pushes `base` to
  the cloud and every other device picks it up.
- **Works offline as a PWA.** `sw.js` is network-first with an offline
  fallback; its cache name is stamped with the deploying commit, so a deploy
  retires the previous cache. An open tab gets an update *toast with a button* —
  it never reloads out from under someone mid-task.

The Supabase table (created once via the SQL in Setup → Show setup SQL):

```sql
create table if not exists public.tracker_state (
  site text not null, part text not null,
  data jsonb not null, updated_at timestamptz not null default now(),
  primary key (site, part));
alter table public.tracker_state enable row level security;
revoke all on table public.tracker_state from anon, authenticated;
grant select, insert, update on table public.tracker_state to anon;
drop policy if exists "tracker read" on public.tracker_state;
drop policy if exists "tracker insert" on public.tracker_state;
drop policy if exists "tracker update" on public.tracker_state;
create policy "tracker read" on public.tracker_state for select to anon using (true);
create policy "tracker insert" on public.tracker_state for insert to anon with check (true);
create policy "tracker update" on public.tracker_state for update to anon using (true) with check (true);
```

That grant and those policies mean **anyone with the URL + publishable or
legacy anon key can read and write the data. There is no login.** That is the
accepted trade for not running accounts; it is documented in the README and
surfaced in the SQL dialog.

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

## 8. What landed since the first handoff

All of this is done, tested and deployed. Listed so you don't rebuild it.

| | |
|---|---|
| **Die lookup** | 996 sub-assemblies from the Sub-Assembly Section Book, both directions (*what is S80.106* / *where does 80-105 go*), plus **883 die pictures** — 620 full drawing sheets and 263 Assembly Diagram thumbnails pulled from the Listings where a sheet could not be got. 163 of the 164 book-known dies in use have a picture. |
| **Staging page** | The step before rolling. An overlay on the rolling lines, not a queue of its own, so a staged line is the same line the roller picks up. Lines already running or finished are past staging and drop out. |
| **Today** | Cross-machine board plus carried-over to-dos. |
| **Manual jobs** | Add a line that is in no workbook (service orders). Survives re-import. |
| **Routing SOP** | §3 above. `js/routing.js` + the per-line route/paperwork panel. |
| **Online-first PWA** | Modular Pages artifact, lazy engineering libraries, service worker, update prompt and `test/offline-check.mjs`. |
| **Tombstones** | Deletes that don't resurrect. |
| **Visual QA** | `test/visual-qa.mjs` — 10 screens × 5 widths × 2 themes, measured not eyeballed. |

### Open questions worth putting to the user

1. **300 lines contradict the routing SOP.** They carry one of the five saw
   dies (`SA80-104/105/255/256/261`) but are scheduled on **FOM 2**, where the
   SOP routes them through the Elumatec saw and the widths punch. The app flags
   this in red on the line rather than hiding it. Either the schedules predate
   v8.0 or the rule is an addition to what FOM 2 already does — unresolved.
2. **Widths Punch vs Multi Punch.** The SOP draws them as separate stations with
   separate paperwork; the schedules only ever name one punch, and the app has
   one machine. Widths Punch is shown on the route but never assigned to.
3. **`S89.083HT`** is the one die in use with no picture at all.
4. Is the CNC machine called **CNC 1 or CNC-3**? (see below)

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
- **No runtime font requests or external assets.** IBM Plex Sans and Mono are
  checked in under `assets/fonts/` and inlined into `Cutting-Tracker.html` by
  `build.mjs`, so the standalone file remains genuinely self-contained.
- Must stay legible **on a shop floor**: gloved taps, glare, phones and desk
  monitors. Touch targets stay generous; the 3-way status control must not
  shrink.
- **Dark mode must keep working** — tokens are defined once and only values
  change under `prefers-color-scheme: dark`.
- Transitions stay short (120–180 ms) and are disabled under
  `prefers-reduced-motion`.
- Every `.centre` page shares one stylesheet; changes hit all four centres,
  Rush, Back Orders and Shift Update at once.
- **Do not rename selectors casually.** The browser suite asserts on structure
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
- The Supabase key rotation and first live schedule import still need an owner
  to confirm them on the production devices (see §6).

---

## 9. Traps that already bit — don't repeat these

1. **Direct `render()` from inside a view handler** → `removeChild` throws when
   an input has focus. Always `scheduleRender()`.
2. **Keying overlays on anything but the imported wo+die** → silent data loss on
   re-import or on editing a die.
3. **Inferring the shift-update sheet.** Reading all four and merging by
   date+shift let stale Afternoon data beat the live Day block. Choosing by tab
   visibility still allowed a hidden archive fallback. The confirmed rule is
   exact: **CNC workbook → `Shift Update`, or report it missing**. `CNC-3`
   maps to the `cnc1` work centre independently of the sheet choice.
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
8. **Do not remove `package-lock.json`.** CI uses `npm ci`; the lockfile and
   exact development versions make the build and test gate reproducible.
9. **CSS ordering.** Equal-specificity rules declared *later* win, and this
   sheet is one file. Four separate regressions came from writing a rule above
   the block it needed to beat — phone tap targets, the focus ring, the header
   width rules, the die link. The phone, focus and header blocks live at the
   **end of the sheet on purpose**. Put new overrides after what they override,
   or raise specificity deliberately.
10. **`transform` on `.centre` broke `position: fixed` children.** A page-in
    keyframe with a transform makes the element the containing block for fixed
    descendants while it runs, which threw the bulk-action bar to the bottom of
    a 9,000px document for 180 ms after *every* re-render. The animation is
    opacity-only now. Same trap applies to `filter` and `backdrop-filter`.
11. **Assuming a column is populated.** The `MultiPunch & SAW` sheet has a SAW
    column and it is **entirely empty**; PUNCH carries 30 `IP` marks. Check a
    column has data before routing logic through it.
12. **A test assertion that cannot fail is worthless.** When adding one, break
    the fix deliberately and confirm the test goes red. The nav-visibility check
    was written that way and caught six pages when reverted.

---

## 10. Suggested prompt for continuing elsewhere

Paste this above the file when handing to ChatGPT or another assistant.

> I'm continuing work on a production tracker for the Cutting department of a
> window-and-curtainwall fabricator. It is a **zero-dependency vanilla-JS app** —
> no framework, no build-time UI library, no runtime packages — that must run
> as a **modular online-first PWA** on GitHub Pages, while retaining a single
> self-contained offline HTML rollback that can be double-clicked from a
> network share.
>
> The handoff below covers the architecture, the verified quirks of the two
> source Excel workbooks, the routing SOP, and the invariants I must not break.
> **Read it fully before proposing anything.**
>
> How I want you to work on this:
>
> - **Do not suggest adding dependencies.** Not React, not SheetJS, not a CSS
>   framework, not a date library. The offline-single-file constraint is the
>   whole reason the code looks like it does.
> - **Verify against the data before asserting anything about it.** Most of the
>   expensive mistakes in this project came from assuming a column was populated
>   or a label meant what it looked like. If you can't check, say so.
> - **Prefer showing nothing over showing something plausible-but-wrong.** Where
>   the app infers something it says so and says why, so it can be overruled.
> - Comments explain **why**, not what; commit messages are long and record what
>   was rejected and why. Match that.
> - The browser suite asserts on DOM structure. CSS-only changes are usually safe;
>   **renaming a class is not**.
> - The repo is **public**. Never put credentials, real work orders or customer
>   names in it.
>
> If something in here is ambiguous or looks wrong, ask me rather than picking
> an interpretation and building on it.
>
> [paste this file]
