/* Project directory derived from the separate Daily Schedule workbook. One
   project can legitimately carry several job codes or colours, so both are
   shown as sets rather than letting the last row silently win. */

import { el, icon, chip, fmtNum } from '../ui.js';
import { state } from '../store.js';

const view = { q: '' };

function add(set, value) {
  const clean = String(value || '').trim();
  if (clean) set.add(clean);
}

function swatchFor(value) {
  const color = String(value || '').toUpperCase();
  if (/^#[0-9A-F]{6}$/.test(color)) return color;
  const choices = [
    [/CHARCOAL|GRAPHITE/, '#374151'], [/BLACK/, '#171717'], [/WHITE/, '#f8fafc'],
    [/CLEAR|SILVER|ALUMIN/, '#cbd5e1'], [/BRONZE/, '#76553c'], [/GREY|GRAY/, '#64748b'],
    [/BLUE/, '#2563eb'], [/GREEN/, '#15803d'], [/RED/, '#b91c1c'], [/BEIGE|SAND/, '#c9b896'],
  ];
  return choices.find(([pattern]) => pattern.test(color))?.[1] || null;
}

function projects() {
  const byName = new Map();
  for (const row of state.dailyOrders || []) {
    const name = String(row.project || '').trim();
    if (!name) continue;
    if (!byName.has(name)) byName.set(name, { name, jobs: new Set(), colors: new Set(), series: new Set(), orders: 0 });
    const project = byName.get(name);
    add(project.jobs, row.jobCode);
    add(project.colors, row.color);
    add(project.series, row.series);
    project.orders++;
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function projectCard(project) {
  const colors = [...project.colors].sort();
  const jobs = [...project.jobs].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const series = [...project.series].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const jobValues = jobs.length ? jobs.map((job) => chip(job, 'work'))
    : [el('span.muted', {}, 'Not listed')];
  const colorValues = colors.length ? colors.map((color) => el('span.project-color', {},
    el('span.project-swatch', { style: { backgroundColor: swatchFor(color) || 'transparent' } }), color))
    : [el('span.muted', {}, 'Not listed in workbook')];
  const seriesValues = series.length ? series.map((item) => chip(item, 'mute'))
    : [el('span.muted', {}, 'Not listed')];
  return el('article.project-card', {},
    el('div.project-card-head', {},
      el('span.project-mark', { 'aria-hidden': 'true' }, project.name.slice(0, 2).toUpperCase()),
      el('div', {}, el('h2', {}, project.name), el('span', {}, `${fmtNum(project.orders)} schedule row${project.orders === 1 ? '' : 's'}`))),
    el('dl.project-facts', {},
      el('div', {}, el('dt', {}, 'Job code'), el('dd', {}, ...jobValues)),
      el('div', {}, el('dt', {}, 'Colour / finish'), el('dd', {}, ...colorValues)),
      el('div', {}, el('dt', {}, 'Series'), el('dd', {}, ...seriesValues))));
}

export function renderProjects(rerender, go) {
  const all = projects();
  const query = view.q.trim().toLowerCase();
  const shown = query ? all.filter((project) =>
    [project.name, ...project.jobs, ...project.colors, ...project.series]
      .some((value) => String(value).toLowerCase().includes(query))) : all;

  const head = el('div.centre-head', {},
    el('div.row.centre-title-row', {},
      el('div.centre-ident', {},
        el('span.centre-rail', { 'aria-hidden': 'true' }),
        el('div', {},
          el('h1.centre-title', {}, 'Projects'),
          el('div.centre-sub', {}, `${fmtNum(all.length)} projects · names, colours and job codes`)))));

  if (!(state.dailyOrders || []).length) {
    return el('div.centre.projects-page', {}, head,
      el('div.panel', {}, el('div.empty', {},
        el('div.empty-icon', {}, icon('upload', { size: 28 })),
        el('h3', {}, 'Daily Schedule is not loaded'),
        el('p', {}, 'This directory is built from the separate Daily Schedule workbook.'),
        el('button.primary', { onclick: () => go('setup') }, 'Import in Setup'))));
  }

  return el('div.centre.projects-page', {}, head,
    el('label.project-search', {},
      el('span', {}, icon('search', { size: 17 })),
      el('input', {
        type: 'search', value: view.q, placeholder: 'Search project, job code, colour or series',
        'aria-label': 'Search projects',
        oninput: (event) => { view.q = event.target.value; rerender(); },
      })),
    shown.length
      ? el('div.project-grid', {}, ...shown.map(projectCard))
      : el('div.panel', {}, el('div.empty', {},
          el('h3', {}, 'No matching project'),
          el('p', {}, 'Try a project name, job code, colour or series.'))),
    !state.dailyMeta?.colorColumnFound ? el('div.resource-notice.project-notice', {},
      icon('alert', { size: 18 }),
      el('div', {}, el('strong', {}, 'No colour column was detected in this revision.'),
        el('p', {}, 'Project names and job codes are still complete; colour is shown only when the workbook supplies it.'))) : null);
}
