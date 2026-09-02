/* Project directory derived from the separate Daily Schedule workbook. One
   project can legitimately carry several job codes or colours, so both are
   shown as sets rather than letting the last row silently win. */

import { el, icon, chip, fmtNum } from '../ui.js';
import { state } from '../store.js';
import { chooseMaterialColorFile } from '../material-colors.js';
import { projectColorKey, projectWorkOrderKey } from '../project-color-key.js';

const pageSize = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches ? 6 : 12;
const view = { q: '', limit: pageSize() };

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
    if (!byName.has(name)) byName.set(name, {
      name, jobs: new Set(), colors: new Set(), referenceColors: new Set(),
      workOrders: new Set(), series: new Set(), orders: 0, quantity: 0, referenceMatch: null,
    });
    const project = byName.get(name);
    add(project.jobs, row.jobCode);
    add(project.colors, row.color);
    add(project.workOrders, row.wo);
    add(project.series, row.series);
    project.orders++;
    const quantity = Number(row.qty);
    if (Number.isFinite(quantity)) project.quantity += quantity;
  }

  const reference = state.projectColorReference;
  for (const project of byName.values()) {
    if (!reference) continue;
    const orderFinishes = new Map();
    let matchedOrders = 0;
    for (const workOrder of project.workOrders) {
      const finishes = reference.workOrders?.[projectWorkOrderKey(workOrder)] || [];
      if (finishes.length) matchedOrders++;
      for (const finish of finishes) orderFinishes.set(finish, (orderFinishes.get(finish) || 0) + 1);
    }
    if (orderFinishes.size) {
      const minimum = matchedOrders >= 3 ? 2 : 1;
      const ranked = [...orderFinishes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      for (const [finish, hits] of ranked) if (hits >= minimum) add(project.referenceColors, finish);
      // Do not turn a sparse but exact match into an empty result.
      if (!project.referenceColors.size && ranked[0]) add(project.referenceColors, ranked[0][0]);
    }
    if (project.referenceColors.size) project.referenceMatch = 'work order';
    else {
      for (const finish of reference.projects?.[projectColorKey(project.name)] || []) add(project.referenceColors, finish);
      if (project.referenceColors.size) project.referenceMatch = 'project';
    }
  }

  return [...byName.values()].sort((a, b) =>
    b.quantity - a.quantity || b.orders - a.orders || a.name.localeCompare(b.name));
}

function projectCard(project) {
  const scheduleColors = [...project.colors].sort();
  const referenceColors = [...project.referenceColors].filter((finish) => !project.colors.has(finish));
  const colors = [...scheduleColors, ...referenceColors];
  const jobs = [...project.jobs].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const series = [...project.series].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const jobValues = jobs.length ? jobs.map((job) => chip(job, 'work'))
    : [el('span.muted', {}, 'Not listed')];
  const colorValues = colors.length ? colors.map((color) => el('span.project-color' + (project.referenceColors.has(color) ? '.from-reference' : ''), {
    title: project.referenceColors.has(color) ? `From Material Requests · exact ${project.referenceMatch} match` : 'From Daily Schedule',
  }, el('span.project-swatch', { style: { backgroundColor: swatchFor(color) || 'transparent' } }), color))
    : [el('span.muted', {}, 'Not listed in workbook')];
  const seriesValues = series.length ? series.map((item) => chip(item, 'mute'))
    : [el('span.muted', {}, 'Not listed')];
  return el('article.project-card', {},
    el('div.project-card-head', {},
      el('span.project-mark', { 'aria-hidden': 'true' }, project.name.slice(0, 2).toUpperCase()),
      el('div', {}, el('h2', {}, project.name), el('span', {},
        `${fmtNum(project.quantity)} pcs · ${fmtNum(project.orders)} schedule row${project.orders === 1 ? '' : 's'}`))),
    el('dl.project-facts', {},
      el('div', {}, el('dt', {}, 'Job code'), el('dd', {}, ...jobValues)),
      el('div', {}, el('dt', {}, 'Colour / finish'), el('dd', {}, ...colorValues,
        project.referenceColors.size ? el('span.project-source', {}, `Request history · ${project.referenceMatch}`) : null)),
      el('div', {}, el('dt', {}, 'Series'), el('dd', {}, ...seriesValues))));
}

export function renderProjects(rerender, go) {
  const all = projects();
  const matched = all.filter((project) => project.referenceColors.size).length;
  const query = view.q.trim().toLowerCase();
  const shown = query ? all.filter((project) =>
    [project.name, ...project.jobs, ...project.colors, ...project.referenceColors, ...project.workOrders, ...project.series]
      .some((value) => String(value).toLowerCase().includes(query))) : all;
  const visible = shown.slice(0, view.limit);

  const head = el('div.centre-head', {},
    el('div.row.centre-title-row', {},
      el('div.centre-ident', {},
        el('span.centre-rail', { 'aria-hidden': 'true' }),
        el('div', {},
          el('h1.centre-title', {}, 'Projects'),
          el('div.centre-sub', {}, `${fmtNum(all.length)} projects · highest production quantity first${state.projectColorReference ? ` · ${fmtNum(matched)} colour matched` : ''}`)))));

  if (!(state.dailyOrders || []).length) {
    return el('div.centre.projects-page', {}, head,
      el('div.panel', {}, el('div.empty', {},
        el('div.empty-icon', {}, icon('upload', { size: 28 })),
        el('h3', {}, 'Daily Schedule is not loaded'),
        el('p', {}, 'This directory is built from the separate Daily Schedule workbook.'),
        el('button.primary', { onclick: () => go('setup') }, 'Import in Setup'))));
  }

  return el('div.centre.projects-page', {}, head,
    el('div.project-tools', {},
      el('label.project-search', {},
        el('span', {}, icon('search', { size: 17 })),
        el('input', {
          type: 'search', value: view.q, placeholder: 'Search project, job code, colour or series',
          'aria-label': 'Search projects',
          oninput: (event) => { view.q = event.target.value; view.limit = pageSize(); rerender(); },
        })),
      el('button.project-colour-load', { onclick: () => chooseMaterialColorFile(rerender) },
        icon('upload', { size: 17 }), state.projectColorReference ? 'Update colour reference' : 'Load Material Requests')),
    shown.length
      ? el('div', {},
        el('div.project-results-head', {},
          el('strong', {}, `Showing ${fmtNum(visible.length)} of ${fmtNum(shown.length)}`),
          query ? el('span', {}, 'Search results') : el('span', {}, 'Highest scheduled quantity first')),
        el('div.project-grid', {}, ...visible.map(projectCard)),
        visible.length < shown.length ? el('button.project-more', {
          onclick: () => { view.limit += pageSize(); rerender(); },
        }, `Show ${fmtNum(Math.min(pageSize(), shown.length - visible.length))} more of ${fmtNum(shown.length)}`) : null)
      : el('div.panel', {}, el('div.empty', {},
          el('h3', {}, 'No matching project'),
          el('p', {}, 'Try a project name, job code, colour or series.'))),
    state.projectColorReference ? el('div.resource-notice.project-notice.ok', {},
      icon('check', { size: 18 }),
      el('div', {}, el('strong', {}, `${fmtNum(matched)} active projects matched to request history.`),
        el('p', {}, `${state.projectColorReference.fileName} · ${fmtNum(state.projectColorReference.count)} colour entries · exact work orders are used before project names.`)))
      : el('div.resource-notice.project-notice', {},
        icon('alert', { size: 18 }),
        el('div', {}, el('strong', {}, 'More project colours are available.'),
          el('p', {}, 'Load the populated Material Requests history once. Only colour mappings are saved and shared; request rows are not stored.'))),
    !state.dailyMeta?.colorColumnFound && !state.projectColorReference ? el('div.resource-notice.project-notice', {},
      icon('alert', { size: 18 }),
      el('div', {}, el('strong', {}, 'No colour column was detected in this Daily Schedule revision.'),
        el('p', {}, 'Project names and job codes are still complete.'))) : null);
}
