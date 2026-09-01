/* The separate Daily Schedule workbook, reduced to one cutting date and
   grouped by project. Machine queues remain owned by their own two workbooks;
   this page never pretends a Daily Sched order is assigned to a machine. */

import { el, icon, chip, fmtDate, fmtNum, printDocument } from '../ui.js';
import { state } from '../store.js';
import { today } from '../model.js';

const PAGE = 6;
const view = { date: null, expanded: {} };

function defaultDate(dates) {
  const ref = today();
  return dates.includes(ref) ? ref : dates.find((date) => date > ref) || dates.at(-1) || ref;
}

function statusOf(row) {
  const raw = String(row.cutStatus || '').trim();
  const key = raw.toUpperCase().replace(/[.\s/]+/g, '');
  if (/^(DONE|COMPLETE|COMPLETED|OK|CUTOK|ROLLED)$/.test(key)) return { label: raw || 'Done', tone: 'ok', rank: 3 };
  if (/^(IP|INPROGRESS|ROLLING)$/.test(key)) return { label: raw || 'In progress', tone: 'work', rank: 1 };
  if (/^(BO|BACKORDER|NR|NOTRECEIVED)$/.test(key)) return { label: raw || 'Attention', tone: 'bad', rank: 0 };
  return { label: raw || 'Not started', tone: 'mute', rank: 2 };
}

function rowSort(a, b) {
  return statusOf(a).rank - statusOf(b).rank
    || String(a.wo || '').localeCompare(String(b.wo || ''), undefined, { numeric: true })
    || String(a.floor || '').localeCompare(String(b.floor || ''), undefined, { numeric: true });
}

function scheduleRow(row) {
  const status = statusOf(row);
  return el(`div.schedule-row.status-${status.tone}`, {},
    el('span.schedule-row-main', {},
      el('span.schedule-row-id', {},
        el('span.mono', {}, row.wo || '—'),
        row.jobCode ? chip(row.jobCode, 'mute') : null,
        row.color ? chip(row.color, 'mute') : null),
      el('span.schedule-row-project', {}, row.floor || 'No floor listed',
        row.series ? el('span.muted', {}, ` · ${row.series}`) : null)),
    el('span.schedule-row-qty', {}, el('b.mono', {}, fmtNum(row.qty)), el('small', {}, 'units')),
    chip(status.label, status.tone));
}

function projectCard(name, rows, rerender) {
  const id = name || '__none__';
  const shown = view.expanded[id] || PAGE;
  const remaining = rows.length - shown;
  const done = rows.filter((row) => statusOf(row).tone === 'ok').length;
  const running = rows.filter((row) => statusOf(row).tone === 'work').length;
  return el('section.schedule-machine', {},
    el('header.schedule-machine-head', {},
      el('span.schedule-machine-icon', {}, icon('job', { size: 19 })),
      el('div', {},
        el('h2', {}, name || 'Project not listed'),
        el('span', {}, `${rows.length} order${rows.length === 1 ? '' : 's'} · ${fmtNum(rows.reduce((n, row) => n + (Number(row.qty) || 0), 0))} units`)),
      el('span.spacer'),
      running ? chip(`${running} in progress`, 'work') : chip(`${done} done`, done === rows.length ? 'ok' : 'mute')),
    el('div.schedule-machine-body', {}, ...rows.slice(0, shown).map(scheduleRow)),
    remaining > 0 ? el('button.schedule-more', {
      type: 'button',
      onclick: () => { view.expanded[id] = shown + PAGE; rerender(); },
    }, `Show ${Math.min(PAGE, remaining)} more of ${rows.length}`) : null);
}

function printSchedule(date, groups) {
  const body = el('div.print-daily-schedule', {},
    ...groups.map(([project, rows]) => el('section.print-table-group', {},
      el('h2', {}, project || 'Project not listed', el('span', {}, ` · ${rows.length} orders`)),
      el('table.print-table', {},
        el('thead', {}, el('tr', {},
          el('th', {}, 'Work order'), el('th', {}, 'Job code'), el('th', {}, 'Floor'),
          el('th', {}, 'Series'), el('th', {}, 'Qty'), el('th', {}, 'Colour'), el('th', {}, 'Cut status'))),
        el('tbody', {}, ...rows.map((row) => el('tr', {},
          el('td.mono', {}, row.wo || '—'),
          el('td.mono', {}, row.jobCode || '—'),
          el('td', {}, row.floor || '—'),
          el('td', {}, row.series || '—'),
          el('td.num.mono', {}, fmtNum(row.qty)),
          el('td', {}, row.color || '—'),
          el('td', {}, statusOf(row).label))))))));
  printDocument({
    title: `Daily Schedule — ${fmtDate(date, { withDay: true })}`,
    subtitle: 'Separate Daily Schedule workbook · grouped by project',
    meta: [`${groups.reduce((n, [, rows]) => n + rows.length, 0)} orders`],
    body,
    landscape: true,
  });
}

export function renderSchedule(rerender, go) {
  const source = state.dailyOrders || [];
  const dates = [...new Set(source.map((row) => row.cuttingDate).filter(Boolean))].sort();
  if (!view.date) view.date = defaultDate(dates);
  const date = view.date;
  const rows = source.filter((row) => row.cuttingDate === date).sort(rowSort);
  const grouped = new Map();
  for (const row of rows) {
    const project = row.project || '';
    if (!grouped.has(project)) grouped.set(project, []);
    grouped.get(project).push(row);
  }
  const groups = [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const selectedIndex = dates.indexOf(date);
  const previous = selectedIndex > 0 ? dates[selectedIndex - 1] : [...dates].reverse().find((item) => item < date);
  const next = selectedIndex >= 0 && selectedIndex < dates.length - 1
    ? dates[selectedIndex + 1] : dates.find((item) => item > date);
  const done = rows.filter((row) => statusOf(row).tone === 'ok').length;
  const running = rows.filter((row) => statusOf(row).tone === 'work').length;
  const pieces = rows.reduce((n, row) => n + (Number(row.qty) || 0), 0);
  const pct = rows.length ? Math.round(done / rows.length * 100) : 0;

  const head = el('div.centre-head.schedule-head', {},
    el('div.row.centre-title-row.printable-title-row', {},
      el('div.centre-ident', {},
        el('span.centre-rail', { 'aria-hidden': 'true' }),
        el('div', {},
          el('h1.centre-title', {}, 'Daily Schedule'),
          el('div.centre-sub', {}, state.dailyMeta
            ? `${fmtDate(date, { withDay: true })} · ${state.dailyMeta.fileName}`
            : 'Separate Daily Schedule workbook'))),
      el('span.spacer'),
      el('button.print-action', {
        type: 'button', disabled: !rows.length,
        onclick: () => printSchedule(date, groups),
      }, icon('print', { size: 17 }), 'Print day')));

  if (!source.length) {
    return el('div.centre.daily-schedule', {}, head,
      el('div.panel', {}, el('div.empty', {},
        el('div.empty-icon', {}, icon('upload', { size: 28 })),
        el('h3', {}, 'Daily Schedule is not loaded'),
        el('p', {}, 'Import the separate Daily Schedule workbook in Setup. Machine schedules do not fill this page.'),
        el('button.primary', { onclick: () => go('setup') }, 'Import in Setup'))));
  }

  return el('div.centre.daily-schedule', {},
    head,
    el('section.schedule-toolbar', { 'aria-label': 'Schedule date' },
      el('button.schedule-date-step', {
        type: 'button', disabled: !previous, 'aria-label': 'Previous scheduled day',
        onclick: () => { view.date = previous; view.expanded = {}; rerender(); },
      }, icon('chevron-left', { size: 19 })),
      el('label.schedule-date', {},
        el('span', {}, 'Cutting date'),
        el('input', {
          type: 'date', value: date,
          onchange: (event) => { view.date = event.target.value || today(); view.expanded = {}; rerender(); },
        })),
      el('button.schedule-date-step', {
        type: 'button', disabled: !next, 'aria-label': 'Next scheduled day',
        onclick: () => { view.date = next; view.expanded = {}; rerender(); },
      }, icon('chevron', { size: 19 })),
      date !== today() && dates.includes(today()) ? el('button.schedule-today', {
        type: 'button', onclick: () => { view.date = today(); view.expanded = {}; rerender(); },
      }, 'Today') : null),

    el('div.schedule-kpis', {},
      el('div.schedule-kpi', {}, el('b', {}, fmtNum(rows.length)), el('span', {}, 'orders')),
      el('div.schedule-kpi', {}, el('b', {}, fmtNum(pieces)), el('span', {}, 'units')),
      el('div.schedule-kpi.work', {}, el('b', {}, fmtNum(running)), el('span', {}, 'in progress')),
      el('div.schedule-kpi.ok', {}, el('b', {}, `${pct}%`), el('span', {}, `${done} done`))),

    rows.length
      ? el('div.schedule-grid', {}, ...groups.map(([project, projectRows]) =>
          projectCard(project, projectRows, rerender)))
      : el('div.panel', {}, el('div.empty', {},
          el('div.empty-icon', {}, icon('calendar', { size: 28 })),
          el('h3', {}, 'Nothing has this cutting date'),
          el('p', {}, previous || next
            ? 'Use the arrows to move to the nearest date in the Daily Schedule.'
            : 'No other cutting date was found in the imported file.'))));
}
