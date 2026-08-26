/* "Where does this one go, and what has to go with it?"

   The whole of SOP-WW-CUT-008 for one line: the stations it passes through in
   order, which one it is standing at now, and against each the document set
   that has to travel with it and whose office to get that from when it is not
   already at the machine.

   The paperwork half is the reason this is a page and not a badge. Knowing a
   height goes to the saw is not much use if the cutsheets are still in Firas's
   office — that is the thing that actually stops the job. */

import { el, chip, icon, modal } from '../ui.js';
import { routeFor, needsFmc, SOP, SAW_WIDTH_DIES, isHighThermal } from '../routing.js';
import { MACHINE_BY_KEY } from '../machines.js';
import { machineConfig, jobStations } from '../model.js';

const TRACK = {
  vents: { label: 'Vents', tone: 'work', note: 'a separate entity from window wall' },
  widths: { label: 'Window wall — widths', tone: 'ok', note: null },
  heights: { label: 'Window wall — heights', tone: 'ok', note: null },
  ww: { label: 'Window wall', tone: 'ok', note: 'not split into widths or heights yet' },
};

function stepRow(step, i, at, stations) {
  /* Where the schedules actually have this job, not where its position in the
     list implies it should be. A station with no row for this job at all falls
     back to position — the SOP says it passes through, the workbook just does
     not carry it. */
  const known = step.machine ? stations[step.machine] : undefined;
  const done = known ? known === 'DONE' : (at >= 0 && i < at);
  const here = known ? known === 'IN_PROGRESS' : i === at;
  const waiting = known === 'NOT_STARTED' && i < at;
  const label = step.machine
    ? machineConfig(MACHINE_BY_KEY[step.machine] || { key: step.machine, label: step.station }).label
    : null;

  return el('div.route-step' + (here ? '.here' : '') + (done ? '.past' : '')
    + (waiting ? '.waiting' : ''), {},
    el('div.route-mark', { 'aria-hidden': 'true' },
      here ? icon('arrow', { size: 13 }) : done ? icon('check', { size: 12 }) : el('span.route-dot', {})),
    el('div.route-body', {},
      el('div.route-station', {},
        el('strong', {}, step.station),
        here ? chip('here now', 'ok') : null,
        done ? chip('done', 'mute') : null,
        /* Behind the line's own position: something downstream has moved on
           and this station has not started. Worth saying out loud — it is
           either a row nobody updated or a job that genuinely skipped a step. */
        waiting ? chip('not started', 'warn') : null,
        // The station's own name on the flowchart and the machine's name in
        // the app are not always the same word; say both once rather than
        // leave someone matching them up.
        label && label !== step.station ? el('span.small.muted', {}, label) : null),
      step.paper
        ? el('div.route-paper', {},
            icon('note', { size: 12 }),
            el('span', {}, el('strong', {}, step.paper),
              step.where ? el('span.muted', {}, ' — ' + step.where) : null))
        : null,
      step.who ? el('div.small.muted.route-who', {}, step.who) : null));
}

/** The routing for one line, as a dialog. */
export function routeDialog(task) {
  const r = routeFor(task);

  const body = el('div.routedlg', {},
    el('div.route-head', {},
      el('span.mono.strong', {}, task.wo || '—'),
      task.die ? el('span.mono.die', {}, task.die) : null,
      el('span.spacer'),
      r ? chip(TRACK[r.track].label, TRACK[r.track].tone) : null));

  if (!r) {
    body.append(el('div.empty', {},
      el('div.empty-icon', {}, icon('alert', { size: 26 })),
      el('h3', {}, 'Not covered by the routing SOP'),
      el('div', {}, `${SOP.id} covers window wall and vents. This line is on `
        + `${machineConfig(MACHINE_BY_KEY[task.machine] || { label: task.machine }).label}, `
        + 'which it does not route — the app falls back to what this component '
        + 'usually gets put on.')));
    return modal('Routing', body, { wide: true });
  }

  /* Filtered, because `append` is not `el`: el() drops a null child, a raw
     DOM append stringifies it and puts the word "null" on the page. The
     discrepancy banner below is null for most lines, which is exactly the
     common case. */
  body.append(...[
    // Why the app thinks this is the track it is, said plainly, because the
    // schedules carry no column for it and this is read off the machine.
    el('div.banner' + (r.sure ? '' : '.warn'), {},
      el('div', {},
        el('strong', {}, r.sure ? 'Routed as ' : 'Read as '),
        TRACK[r.track].label.toLowerCase(),
        r.why ? ` — ${r.why}` : '',
        r.sure ? '.' : '. Change the machine if that is wrong and the route follows.')),

    el('div.route-rule', {}, icon('list', { size: 13 }), el('span', {}, r.rule)),

    /* The line is standing at a station that is not on its own route. That is
       not a rendering gap to paper over — it means the schedule and the SOP
       disagree about this job, and the person looking at the row is the one
       who can say which is right. */
    r.at < 0 && r.steps.some((s) => s.machine)
      ? el('div.banner.bad', {},
          el('div', {},
            el('strong', {}, 'Not on its route. '),
            `The schedule has this on `
            + `${machineConfig(MACHINE_BY_KEY[task.machine] || { label: task.machine }).label}, `
            + `which is not a station on the ${SOP.id} path below.`))
      : null,

    el('div.routesteps', {}, ...(() => {
      const stations = jobStations(task);
      return r.steps.map((s, i) => stepRow(s, i, r.at, stations));
    })()),

    el('div.small.muted.route-src', {},
      `${SOP.id} v${SOP.version} — ${SOP.title}, effective ${SOP.effective}.`),
  ].filter(Boolean));

  return modal('Routing', body, { wide: true });
}

/** The rules themselves, for when someone wants to check the app rather than
    the line. Opened from the routing badge's own dialog and from Setup. */
export function sopDialog() {
  const rule = (head, ...body) => el('div.sopr', {},
    el('div.sopr-head', {}, head), el('div.sopr-body', {}, ...body));

  const body = el('div.sopdlg', {},
    el('p.small.muted', { style: { marginTop: 0 } },
      `${SOP.id} v${SOP.version}, effective ${SOP.effective}. These are the rules the `
      + 'app routes by; where a line is not covered, it falls back to what the '
      + 'component usually gets put on.'),

    rule('Widths — high thermal',
      el('p', {}, 'A die ending ', el('span.mono', {}, 'HT'), ' or ',
        el('span.mono', {}, 'HTX'), ' goes ',
        el('strong', {}, 'only to FOM 2'), ' and skips the saw and the widths punch.')),

    rule('Widths — the five saw dies',
      el('p', {}, 'These, and only these, go through the saw and the widths punch:'),
      el('div.sopdies', {}, ...SAW_WIDTH_DIES.map((d) => el('span.mono.die', {}, d))),
      el('p.small.muted', {}, 'The high thermal versions of the same numbers do not — '
        + 'S80.104 goes this way, S80.104HT does not.')),

    rule('Widths — everything else',
      el('p', {}, 'Straight to FOM 2, skipping the saw and the widths punch.')),

    rule('Heights',
      el('p', {}, 'Elumatec saw, then Multi Punch, then an FMC only if the line has ',
        el('strong', {}, 'pin holes'), ', ', el('strong', {}, 'ISV'), ', or die ',
        el('span.mono', {}, 'SA80.235'), ' / ', el('span.mono', {}, 'SA80.236'), '.')),

    rule('Vents',
      el('p', {}, 'A separate entity: manual rolling, then FOM 3, then straight to '
        + 'vent assembly. Nothing on the window wall line touches it.')),

    rule('What the app cannot tell you',
      el('p', {}, 'The schedules have no column for widths, heights or vents, so the '
        + 'app reads the track off the machine the workbook already has the line on. '
        + 'Where that is a guess it says so on the line.')));

  return modal('Routing rules', body, { wide: true });
}

/** A one-line summary for a row: the next station and what it needs. */
export function nextStationOf(task) {
  const r = routeFor(task);
  if (!r || !r.next) return null;
  return { station: r.next.station, paper: r.next.paper, where: r.next.where, fmc: needsFmc(task) };
}

export { isHighThermal };
