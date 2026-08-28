/* A work order seen whole.

   Every other page in this app is organised by machine, because the workbooks
   are and because an operator stands at one. Nobody asks about a machine
   though. They ask where W/O 31817 has got to, and in the live schedules that
   is a question about four machines at once — 201 of the 272 work orders touch
   more than one centre. Before this page, answering it meant opening four tabs
   and holding the result in your head.

   Nothing here is stored. A job is its own lines seen together, so this page
   and the centre pages cannot drift apart. Editing still happens on the line,
   which is why every row here opens the centre page focused on it. */

import { el, chip, icon, bar, fmtDate, fmtNum, modal } from '../ui.js';
import { allJobs, jobOf, hasTasks, machineConfig } from '../model.js';
import { MACHINE_BY_KEY } from '../machines.js';
import { focusCentreTask } from './centre.js';

/** A machine's name as the department has it — a renamed machine keeps its
    name away from the centre page that renamed it. */
function machineLabel(key) {
  const m = MACHINE_BY_KEY[key];
  return m ? machineConfig(m).label : key;
}

/** The column heading for a station. Falls back to the configured label when a
    machine has been renamed, because a stale built-in abbreviation over a
    renamed machine is worse than a long one. */
function machineShort(key) {
  const m = MACHINE_BY_KEY[key];
  if (!m) return key;
  const cfg = machineConfig(m);
  return cfg.label === m.label ? (m.short || m.label) : cfg.label.slice(0, 4);
}

const TONE = { NOT_STARTED: 'mute', IN_PROGRESS: 'work', DONE: 'ok' };

/* ---------- the pieces, shared by the page and the dialog ---------- */

/** How far along one station is for this job.

    Deliberately not a single status: a station with nine of twelve dies cut is
    neither started nor finished, and rounding it to either is what made people
    open the sheet to check. The count is the answer; the bar is how it reads
    from a step back. */
function stationCell(st) {
  const done = st.done;
  const pct = st.total ? (done / st.total) * 100 : 0;
  const tone = done === st.total ? 'ok' : (st.running || done) ? 'work' : 'mute';
  return el('div.jstation.' + tone, {},
    el('div.jstation-head', {},
      el('span.jstation-name', {}, machineLabel(st.machine)),
      el('span.mono.jstation-count', {}, `${done}/${st.total}`)),
    bar(pct, done === st.total),
    /* Running and waiting are different questions and a station usually has
       both. Collapsing to whichever is larger was how the sheet read, and it
       is why people rang the bay to ask. */
    el('div.jstation-sub.small.muted', {}, done === st.total ? 'finished'
      : [st.running ? `${st.running} running` : null,
        st.waiting ? `${st.waiting} to go` : null].filter(Boolean).join(' · ')));
}

/** The route across the department, in the order material moves. */
function stationRail(job) {
  return el('div.jrail', {}, ...job.stations.map(stationCell));
}

/** One die, with a mark under each station the job visits.

    The columns are the job's stations, not this die's, so the dies line up
    with each other and with the rail above. A die that never goes to a station
    leaves that column empty, which is itself worth seeing — it is usually the
    reason a job looks stuck. */
function dieRow(job, d, onPick) {
  const cells = job.stations.map((st) => {
    const status = d.stations.get(st.machine);
    if (!status) return el('span.jcell.none', { title: `Not on ${machineLabel(st.machine)}` }, '·');
    return el('span.jcell.' + TONE[status.key] + (status.implied ? '.implied' : ''), {
      title: `${machineLabel(st.machine)}: ${status.label}`
        + (status.implied ? ` — inferred, ${status.impliedWhy}` : ''),
    }, status.key === 'DONE' ? icon('check', { size: 13 })
      : status.key === 'IN_PROGRESS' ? icon('play', { size: 12 }) : '');
  });

  const flags = [];
  if (d.lines.some((l) => l.rush.on)) flags.push(chip('Rush', 'warn'));
  if (d.lines.some((l) => l.bo.on)) flags.push(chip('B/O', 'bad'));
  if (d.lines.some((l) => l.note?.text)) flags.push(icon('note', { size: 13 }));
  // Parked work is still part of the job. A die whose remaining stations were
  // all written off would otherwise read as simply unfinished.
  if (d.lines.some((l) => l.parked)) flags.push(chip('Parked', 'mute'));

  /* Opens the line somebody is actually asking about: the first station that
     has not finished this die, or the last one if the whole die is through.
     Opening the first station instead lands you on rolling work that finished
     last week, which is never the question. */
  const target = (d.lines.find((l) => l.status.key !== 'DONE') || d.lines[d.lines.length - 1]).task;

  return el('div.jdie', {
    role: 'button', tabIndex: 0,
    onclick: () => onPick(target),
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(target); } },
  },
    el('div.jdie-id', {},
      el('span.mono.strong', {}, d.die || '—'),
      ...flags),
    el('div.jdie-qty.mono.small.muted', {}, fmtNum(d.qty)),
    el('div.jdie-cells', {}, ...cells));
}

/** The header numbers. Pieces are the honest unit for a job — a job is not
    three-quarters done because three of its four lines are, when the fourth
    carries most of the metal. */
function jobStats(job) {
  const pct = job.total ? (job.done / job.total) * 100 : 0;
  return el('div.jstats', {},
    el('div.jstat', {}, el('b', {}, `${job.done}/${job.total}`), el('i', {}, 'lines done')),
    job.running ? el('div.jstat.work', {}, el('b', {}, fmtNum(job.running)), el('i', {}, 'running')) : null,
    el('div.jstat', {}, el('b', {}, fmtNum(job.pieces)), el('i', {}, 'pieces')),
    job.rush ? el('div.jstat.warn', {}, el('b', {}, fmtNum(job.rush)), el('i', {}, 'rush')) : null,
    job.backOrders ? el('div.jstat.bad', {}, el('b', {}, fmtNum(job.backOrders)), el('i', {}, 'short')) : null,
    job.parked ? el('div.jstat', {}, el('b', {}, fmtNum(job.parked)), el('i', {}, 'parked')) : null,
    el('div.jstat.grow', {}, bar(pct, job.done === job.total),
      el('i', {}, job.open ? `${job.open} still to do` : 'complete')));
}

function jobWhere(job) {
  const bits = [];
  if (job.projects.length) bits.push(job.projects.join(' · '));
  if (job.floors.length) bits.push(job.floors.slice(0, 3).join(', '));
  return bits.join(' — ') || '—';
}

function jobDates(job) {
  if (!job.firstCut && !job.lastCut) {
    return job.undated ? `${job.undated} lines with no cutting date` : '';
  }
  const span = job.firstCut === job.lastCut
    ? fmtDate(job.firstCut)
    : `${fmtDate(job.firstCut)} – ${fmtDate(job.lastCut)}`;
  return `Remaining work cut ${span}`
    + (job.undated ? `, ${job.undated} undated` : '');
}

/** The body of a job, used by both the page and the dialog. */
function jobBody(job, onPick) {
  return el('div.jbody', {},
    stationRail(job),
    el('div.jdies', {},
      el('div.jdie.head', {},
        el('div.jdie-id.small.muted', {}, `${job.dies.length} dies`),
        el('div.jdie-qty.small.muted', {}, 'pcs'),
        el('div.jdie-cells', {}, ...job.stations.map((st) =>
          el('span.jcell.head.small.muted', { title: machineLabel(st.machine) },
            machineShort(st.machine))))),
      ...job.dies.map((d) => dieRow(job, d, onPick))));
}

/* ---------- opened from a line ---------- */

/** Where this line's work order stands everywhere else. Opened from the line
    tools, so an operator can see whether the station before theirs has
    actually finished before they go looking for the material. */
export function jobDialog(task) {
  const job = jobOf(task);
  if (!job) return null;

  /* Navigating by hash rather than through the page's own `go`: this dialog is
     opened from a line on one centre and routinely sends you to a different
     one, and app.js already listens for the change. */
  const pick = (t) => {
    const tab = focusCentreTask(t);
    if (tab) location.hash = tab;
  };

  return modal(`W/O ${job.wo}`, el('div', {},
    el('p.small.muted', { style: { marginTop: 0 } }, jobWhere(job)),
    jobStats(job),
    jobBody(job, (t) => { document.querySelector('dialog[open]')?.close(); pick(t); }),
    el('p.small.muted', {}, jobDates(job))), { wide: true });
}

/* ---------- the page ---------- */

const vs = { q: '', openOnly: true, expanded: null };

export function renderJobs(rerender, go) {
  if (!hasTasks()) {
    return el('div.panel', {},
      el('div.empty', {},
        el('div.empty-icon', {}, icon('upload', { size: 28 })),
        el('h3', {}, 'No schedule loaded yet'),
        el('p', {}, 'Import the Rolling and CNC workbooks to get started.'),
        el('button.primary', { onclick: () => go('setup') }, 'Go to Setup')));
  }

  const list = allJobs({ q: vs.q, openOnly: vs.openOnly });
  const spanning = list.filter((j) => j.stations.length > 1).length;

  const head = el('div.centre-head', {},
    el('div.row.centre-title-row', {},
      el('div.centre-ident', {},
        el('span.centre-rail', { 'aria-hidden': 'true' }),
        el('div', {},
          el('h1.centre-title', {}, 'Jobs'),
          el('div.centre-sub', {}, 'One work order, every station it touches'))),
      el('span.spacer'),
      el('div.centre-stats', {},
        el('div.cstat', {}, el('b', {}, fmtNum(list.length)), el('i', {}, 'jobs')),
        el('div.cstat', {}, el('b', {}, fmtNum(spanning)), el('i', {}, 'across centres')))),
    el('div.centre-filters', {},
      el('input.jsearch', {
        type: 'search', placeholder: 'Search W/O, project, floor, die…', value: vs.q,
        oninput: (e) => { vs.q = e.target.value; rerender(); },
      }),
      el('label.row.small.donetoggle', {},
        el('input', {
          type: 'checkbox', checked: !vs.openOnly,
          onchange: (e) => { vs.openOnly = !e.target.checked; rerender(); },
        }),
        'Include finished')));

  if (!list.length) {
    return el('div.centre', {}, head,
      el('div.panel', {}, el('div.empty', {},
        el('div.empty-icon', {}, icon('search', { size: 28 })),
        el('h3', {}, vs.q ? 'Nothing matches' : 'No open jobs'),
        el('div', {}, vs.q
          ? `No work order, project, floor or die matches “${vs.q}”.`
          : 'Every work order in the schedule is finished.'))));
  }

  const pick = (t) => { const tab = focusCentreTask(t); if (tab) go(tab); };

  /* Collapsed by default. A job carries up to 44 lines across five stations,
     and a page of thirty of those opened at once is a wall — the rail is the
     answer to "where is it", and the dies are only needed once that is not
     enough. */
  /* Long lists are cut rather than paged. A search that narrows to what you
     wanted is faster than a page control, and the count says plainly that
     there is more behind it. */
  const CAP = 60;
  const shown = list.slice(0, CAP);
  const cards = shown.map((job) => {
    const open = vs.expanded === job.wo;
    return el('section.panel.jcard' + (open ? '.open' : ''), {},
      el('button.jhead', {
        'aria-expanded': String(open),
        onclick: () => { vs.expanded = open ? null : job.wo; rerender(); },
      },
        el('div.jhead-id', {},
          el('span.mono.strong', {}, `W/O ${job.wo}`),
          job.rush ? chip('Rush', 'warn') : null,
          job.backOrders ? chip(`B/O ${job.backOrders}`, 'bad') : null,
          job.stations.length > 1 ? chip(`${job.stations.length} stations`, 'mute') : null),
        el('div.jhead-where.small.muted', {}, jobWhere(job)),
        el('span.spacer'),
        jobStats(job),
        el('span.jhead-caret', { 'aria-hidden': 'true' }, icon('chevron', { size: 16 }))),
      open ? el('div.jcard-body', {}, jobBody(job, pick),
        el('p.small.muted.jdates', {}, jobDates(job))) : null);
  });

  return el('div.centre', {}, head, ...cards,
    list.length > CAP
      ? el('p.small.muted.jmore', {},
        `Showing the first ${CAP} of ${fmtNum(list.length)} — search to narrow it down.`)
      : null);
}
