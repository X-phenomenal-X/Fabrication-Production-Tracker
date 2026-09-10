/* The separate Daily Schedule workbook, reduced to one cutting date and
   grouped by project. Machine queues remain owned by their own two workbooks;
   this page never pretends a Daily Sched order is assigned to a machine. */

import { el, icon, chip, fmtDate, fmtNum, printDocument, modal } from '../ui.js';
import { state } from '../store.js';
import { today } from '../model.js';

const PAGE = 6;
const view = { date: null, expanded: {}, scope: 'day', query: '', project: '', section: '', status: '', sort: 'row', direction: 1, limit: 60, groupLimit: 6 };

const COLUMNS = [
  ['wo', 'Work order'], ['project', 'Project'], ['jobCode', 'Job code'],
  ['floor', 'Floor / area'], ['qty', 'Units'], ['series', 'Series'],
  ['color', 'Colour'], ['cuttingDate', 'Cutting'], ['glazingDate', 'Glazing'],
  ['shipDate', 'Shipping'], ['cutStatus', 'Cut status'], ['materialStatus', 'Material'],
];

function openOrder(row, origin) {
  modal(`Work order ${row.wo || 'not listed'}`, el('div.schedule-detail', {},
    el('p', {}, row.project || 'Project not listed'),
    el('dl.schedule-detail-grid', {},
      ...[...COLUMNS.slice(2), ['section', 'Workbook section'], ['row', 'Excel row']].map(([key, label]) =>
        el('div', {}, el('dt', {}, label), el('dd', {}, row[key] ?? 'Not listed')))),
    el('h3', {}, 'Workbook notes'), el('p.schedule-detail-note', {}, row.notes || 'No notes in the workbook.'),
    el('p.small.muted', {}, 'Read from the separate Daily Schedule workbook. Refresh that file in Setup to update these values.')),
  { wide: true, origin });
}

function matches(row) {
  if (view.scope === 'day' && row.cuttingDate !== view.date) return false;
  if (view.scope === 'undated' && row.cuttingDate) return false;
  if (view.project && row.project !== view.project) return false;
  if (view.section && row.section !== view.section) return false;
  if (view.status && statusOf(row).tone !== view.status) return false;
  const haystack = [...COLUMNS.map(([key]) => row[key]), row.notes, row.section].join(' ').toLowerCase();
  return view.query.trim().toLowerCase().split(/\s+/).every(term => haystack.includes(term));
}

function sheetSort(a, b) {
  const key = view.sort;
  const av = a[key], bv = b[key];
  if (av == null && bv != null) return 1;
  if (bv == null && av != null) return -1;
  const order = key === 'qty' || key === 'row'
    ? (Number(av) || 0) - (Number(bv) || 0)
    : String(av || '').localeCompare(String(bv || ''), undefined, { numeric: true, sensitivity: 'base' });
  return order * view.direction || (a.row || 0) - (b.row || 0);
}

function spreadsheet(rows, rerender) {
  return el('section.schedule-sheet.schedule-machine', {},
    el('div.schedule-sheet-scroll', { tabindex: 0, role: 'region', 'aria-label': 'Schedule spreadsheet. Scroll horizontally for dates and material status.' },
      el('table.schedule-table', {},
        el('caption', {}, 'Select a work order for notes and details. Scroll right for glazing, shipping and material. Click a heading to sort.'),
        el('thead', {}, el('tr', {},
          el('th', { scope: 'col', 'aria-sort': view.sort === 'row' ? (view.direction === 1 ? 'ascending' : 'descending') : 'none' },
            el('button', { onclick: () => { view.sort = 'row'; view.direction = 1; rerender(); } }, 'Excel row')),
          ...COLUMNS.map(([key, label]) => el('th', { scope: 'col', 'aria-sort': view.sort === key ? (view.direction === 1 ? 'ascending' : 'descending') : 'none' },
            el('button', { onclick: () => {
              view.direction = view.sort === key ? -view.direction : 1;
              view.sort = key; view.limit = 60; rerender();
            } }, label, view.sort === key ? (view.direction === 1 ? ' ↑' : ' ↓') : ''))))),
        el('tbody', {}, ...rows.slice(0, view.limit).map(row => el('tr.schedule-row', {},
          el('td.muted', {}, row.row ?? '—'),
          ...COLUMNS.map(([key]) => el('td' + (key === 'qty' ? '.num' : ''), {},
            key === 'wo' ? el('button.schedule-order-link', { onclick: event => openOrder(row, event.currentTarget), 'aria-label': `Details for work order ${row.wo}` }, row.wo || '—', row.notes ? icon('note', { size: 14 }) : null)
              : key === 'cutStatus' ? chip(statusOf(row).label, statusOf(row).tone)
                : key === 'qty' ? fmtNum(row.qty)
                  : key.endsWith('Date') ? (row[key] ? fmtDate(row[key]) : '—') : row[key] || '—'))))))),
    rows.length > view.limit ? el('button.schedule-more', { onclick: () => { view.limit += 60; rerender(); } },
      `Show ${Math.min(60, rows.length - view.limit)} more · ${view.limit} of ${rows.length} orders shown`) : null);
}

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

function scheduleRow(row) {
  const status = statusOf(row);
  return el(`button.schedule-row.status-${status.tone}`, { type: 'button', 'aria-label': `Details for work order ${row.wo}`, onclick: event => openOrder(row, event.currentTarget) },
    el('span.schedule-row-main', {},
      el('span.schedule-row-id', {},
        el('span.mono', {}, row.wo || '—'),
        row.jobCode ? chip(row.jobCode, 'mute') : null,
        row.color ? chip(row.color, 'mute') : null),
      el('span.schedule-row-project', {}, row.floor || 'No floor listed',
        row.series ? el('span.muted', {}, ` · ${row.series}`) : null),
      el('span.schedule-row-project', {}, `${row.cuttingDate ? fmtDate(row.cuttingDate) : 'No cutting date'} · ${status.label}`)),
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
          el('th', {}, 'Series'), el('th', {}, 'Qty'), el('th', {}, 'Colour'),
          el('th', {}, 'Cutting'), el('th', {}, 'Glazing'), el('th', {}, 'Shipping'),
          el('th', {}, 'Cut status'), el('th', {}, 'Material'))),
        el('tbody', {}, ...rows.map((row) => el('tr', {},
          el('td.mono', {}, row.wo || '—'),
          el('td.mono', {}, row.jobCode || '—'),
          el('td', {}, row.floor || '—'),
          el('td', {}, row.series || '—'),
          el('td.num.mono', {}, fmtNum(row.qty)),
          el('td', {}, row.color || '—'),
          ...['cuttingDate', 'glazingDate', 'shipDate'].map(key => el('td', {}, row[key] || '—')),
          el('td', {}, statusOf(row).label), el('td', {}, row.materialStatus || '—'))))))));
  printDocument({
    title: `Daily Schedule — ${view.scope === 'day' ? fmtDate(date, { withDay: true }) : view.scope === 'undated' ? 'No cutting date' : 'All dates'}`,
    subtitle: 'Current filtered results · grouped by project',
    meta: [`${groups.reduce((n, [, rows]) => n + rows.length, 0)} orders`],
    body,
    landscape: true,
  });
}

export function renderSchedule(rerender, go) {
  console.log('SCHEDULE RENDER', view.scope, view.status);
  const source = state.dailyOrders || [];
  const dates = [...new Set(source.map((row) => row.cuttingDate).filter(Boolean))].sort();
  if (!view.date) view.date = defaultDate(dates);
  const date = view.date;
  const rows = source.filter(matches).sort(sheetSort);
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
            ? `${view.scope === 'day' ? fmtDate(date, { withDay: true }) : view.scope === 'all' ? 'All dates' : 'No cutting date'} · ${state.dailyMeta.fileName}`
            : 'Separate Daily Schedule workbook'))),
      el('span.spacer'),
      el('button.print-action', {
        type: 'button', disabled: !rows.length,
        onclick: () => printSchedule(date, groups),
      }, icon('print', { size: 17 }), 'Print results')));

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
    el('section.schedule-filters', { 'aria-label': 'Find schedule orders' },
      el('label.schedule-search', {}, el('span', {}, 'Find an order'),
        el('input', { type: 'search', value: view.query, placeholder: 'Work order, project, code, colour or notes…',
          oninput: event => {
            const input = event.currentTarget;
            const position = input.selectionStart;
            view.query = input.value; view.limit = 60; view.expanded = {}; rerender();
            requestAnimationFrame(() => {
              if (document.activeElement !== document.body && document.activeElement !== input) return;
              const replacement = document.querySelector('.schedule-search input');
              replacement?.focus({ preventScroll: true });
              if (replacement && position != null) replacement.setSelectionRange(position, position);
            });
          } })),
      ...[
        ['scope', 'Date range', [['day', 'Selected day'], ['all', 'All dates'], ['undated', 'No cutting date']]],
        ['project', 'Project', [['', 'All projects'], ...[...new Set(source.map(row => row.project).filter(Boolean))].sort().map(x => [x, x])]],
        ['section', 'Workbook section', [['', 'All sections'], ...[...new Set(source.map(row => row.section).filter(Boolean))].sort().map(x => [x, x])]],
        ['status', 'Cut status', [['', 'All statuses'], ['work', 'In progress'], ['ok', 'Complete'], ['bad', 'Needs attention'], ['mute', 'Other / not started']]],
      ].map(([key, label, options]) => el('label', {}, el('span', {}, label),
        el('select', { 'aria-label': label, value: view[key], onchange: event => {
          console.log('FILTER CHANGE', key, event.currentTarget.value, event.currentTarget.isConnected);
          view[key] = event.currentTarget.value; view.limit = 60; view.expanded = {};
          // The app replaces this surface on the next frame. Prevent a second
          // selection from landing on controls that are about to be detached.
          for (const control of event.currentTarget.closest('.schedule-filters').querySelectorAll('select')) control.disabled = true;
          rerender();
        } },
          ...options.map(([value, text]) => el('option', { value, selected: view[key] === value }, text))))),
      el('button', { onclick: () => { Object.assign(view, { scope: 'day', date: defaultDate(dates), query: '', project: '', section: '', status: '', limit: 60, expanded: {}, sort: 'row', direction: 1 }); rerender(); } }, 'Reset filters')),
    el('section.schedule-toolbar', { 'aria-label': 'Schedule date' },
      el('button.schedule-date-step', {
        type: 'button', disabled: view.scope !== 'day' || !previous, 'aria-label': 'Previous scheduled day',
        onclick: () => { view.date = previous; view.expanded = {}; rerender(); },
      }, icon('chevron-left', { size: 19 })),
      el('label.schedule-date', {},
        el('span', {}, 'Cutting date'),
        el('input', {
          type: 'date', value: date, disabled: view.scope !== 'day',
          onchange: (event) => { view.date = event.target.value || today(); view.expanded = {}; rerender(); },
        })),
      el('button.schedule-date-step', {
        type: 'button', disabled: view.scope !== 'day' || !next, 'aria-label': 'Next scheduled day',
        onclick: () => { view.date = next; view.expanded = {}; rerender(); },
      }, icon('chevron', { size: 19 })),
      date !== today() && dates.includes(today()) ? el('button.schedule-today', {
        type: 'button', onclick: () => { view.scope = 'day'; view.date = today(); view.expanded = {}; rerender(); },
      }, 'Today') : null),

    el('div.schedule-kpis', {},
      el('div.schedule-kpi', {}, el('b', {}, fmtNum(rows.length)), el('span', {}, 'orders')),
      el('div.schedule-kpi', {}, el('b', {}, fmtNum(pieces)), el('span', {}, 'units')),
      el('div.schedule-kpi.work', {}, el('b', {}, fmtNum(running)), el('span', {}, 'in progress')),
      el('div.schedule-kpi.ok', {}, el('b', {}, `${pct}%`), el('span', {}, `${done} done`))),

    el('p.schedule-result-summary', { role: 'status' }, `${rows.length} matching orders of ${source.length} imported · ${view.scope === 'day' ? fmtDate(date) : view.scope === 'undated' ? 'No cutting date' : 'All dates'}. Search uses this date range.`,
      view.scope === 'day' ? el('button.ghost', { onclick: () => { view.scope = 'all'; view.limit = 60; view.expanded = {}; rerender(); } }, 'Search all dates') : null),
    rows.length
      ? el('div.schedule-results', {}, spreadsheet(rows, rerender),
          el('div.schedule-grid.schedule-mobile', {}, ...groups.slice(0, view.groupLimit).map(([project, projectRows]) =>
            projectCard(project, projectRows, rerender)),
            groups.length > view.groupLimit ? el('button.schedule-more', { onclick: () => { view.groupLimit += 6; rerender(); } },
              `Show ${Math.min(6, groups.length - view.groupLimit)} more projects · ${view.groupLimit} of ${groups.length}`) : null))
      : el('div.panel', {}, el('div.empty', {},
          el('div.empty-icon', {}, icon('calendar', { size: 28 })),
          el('h3', {}, 'No orders match these filters'),
          el('p', {}, 'Try All dates, a shorter search, or Reset filters.'))));
}
