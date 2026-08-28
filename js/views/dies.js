/* Unified engineering lookup.

   A scheduled S/SA number is a rolled sub-assembly. A bare 80-/89- number is
   one of the individual extrusion profiles that makes an assembly. Operators
   do not think of those as two websites: they ask for a number, a drawing, or
   where a component is used. This workspace searches both libraries and keeps
   the distinction visible in the result type and engineering provenance. */

import { el, chip, icon, modal, printDocument } from '../ui.js';
import {
  lookupDie, searchDies, componentsOf, recoveredComponentsOf,
  listingReferencesOf, componentCoverage, componentAudit, componentUsageOf, dieForms,
  SUBASSEMBLIES,
} from '../dies.js';
import {
  lookupExtrusions, searchExtrusions, extrusionCount, extrusionSeriesCounts,
} from '../extrusions.js';
import { drawingFor, drawingCount } from '../die-drawings.js';

let sectionQuery = '';
let sectionFilter = 'all';
let selectedToken = '';

let imageMap = null;
let imagePrefix = '';
let imagePromise = null;

function ensureExtrusionImages(onReady) {
  if (imageMap || imagePromise) return;
  imagePromise = import('../extrusion-images.js').then((module) => {
    imageMap = module.EXTRUSION_IMAGES;
    imagePrefix = module.EXTRUSION_IMAGE_PREFIX;
  }).catch(() => {
    imageMap = {};
  }).finally(() => {
    imagePromise = null;
    onReady?.();
  });
}

function statusChip(status) {
  if (status === 'Active') return chip('Active', 'ok');
  if (status === 'Obsolete') return chip('Obsolete', 'warn');
  return chip(status, 'bad');
}

function tokenFor(item) {
  return item.type === 'assembly' ? `assembly:${item.assembly.sa}` : `profile:${item.record.key}`;
}

function assemblyItem(assembly, relation = '') {
  return { type: 'assembly', assembly, relation };
}

function profileItem(record) {
  return { type: 'profile', record, relation: '' };
}

function uniquePush(items, seen, item) {
  const token = tokenFor(item);
  if (seen.has(token)) return;
  seen.add(token);
  items.push(item);
}

function collectMatches(query, filter) {
  const die = lookupDie(query);
  const exactProfiles = lookupExtrusions(query);
  const asksForAssembly = /^S(?:A)?\s*\d/i.test(query);
  const asksForProfile = /^\d{2}[.\-_]?\d{2,3}/.test(query);
  const assemblyItems = [];
  const profileItems = [];
  const assemblySeen = new Set();
  const profileSeen = new Set();

  if (die.assembly) uniquePush(assemblyItems, assemblySeen,
    assemblyItem(die.assembly, 'Exact assembly'));
  if (!asksForAssembly) {
    for (const usage of componentUsageOf(query)) {
      const relation = usage.source === 'variant'
        ? `Recovered from ${usage.sourceSa}`
        : usage.source === 'description'
          ? 'Referenced in listing text'
          : `Uses ${die.forms.part}`;
      uniquePush(assemblyItems, assemblySeen, assemblyItem(usage.assembly, relation));
    }
  }
  for (const assembly of searchDies(query, { limit: 50 })) uniquePush(assemblyItems, assemblySeen,
    assemblyItem(assembly));

  const profiles = exactProfiles.length ? exactProfiles : searchExtrusions(query, { limit: 70 });
  for (const record of profiles) uniquePush(profileItems, profileSeen, profileItem(record));

  let items;
  if (filter === 'assemblies') items = assemblyItems;
  else if (filter === 'profiles') items = profileItems;
  else {
    items = asksForProfile && !asksForAssembly
      ? [...profileItems, ...assemblyItems]
      : [...assemblyItems, ...profileItems];
  }

  return { items, assemblyItems, profileItems };
}

function resultRow(item, selected, choose) {
  const assembly = item.assembly;
  const record = item.record;
  const label = assembly?.sa || record.id;
  const description = assembly?.desc || record.description
    || (assembly ? `${assembly.series} Series assembly` : `${record.series} Series profile`);
  const type = assembly ? 'Assembly' : 'Extrusion';

  return el(`button.lookup-result.${item.type}${tokenFor(item) === selected ? '.on' : ''}`, {
    type: 'button',
    onclick: () => choose(item),
    'aria-pressed': String(tokenFor(item) === selected),
  },
    el('span.lookup-result-icon', { 'aria-hidden': 'true' },
      icon(assembly ? 'rollers' : 'extrusion', { size: 17 })),
    el('span.lookup-result-copy', {},
      el('b.mono', {}, label),
      el('small', {}, description),
      item.relation ? el('em', {}, item.relation) : null),
    el('span.lookup-result-type', {}, type),
    icon('chevron', { size: 13 }));
}

function openExtrusionDrawing(record) {
  const body = imageMap?.[record.key];
  if (!body) return;
  modal(`${record.id} · ${record.series} Series`, el('div.extrusion-zoom', {},
    el('img', {
      src: imagePrefix + body,
      alt: `Engineering profile card for ${record.id}`,
    })), { wide: true });
}

function profileField(label, value) {
  if (!value) return null;
  return el('div.extrusion-field', {}, el('span', {}, label), el('b', {}, value));
}

function componentSourceLabel(component) {
  return component.source === 'variant'
    ? `Recovered from ${component.sourceSa}`
    : component.source === 'description'
      ? 'Found in listing text'
      : 'Verified in listing columns';
}

function usageSourceLabel(usage) {
  return usage.source === 'variant'
    ? `Recovered for ${usage.assembly.sa} from ${usage.sourceSa}`
    : usage.source === 'description'
      ? 'Referenced in listing text'
      : `Verified ${usage.role.toLowerCase()}`;
}

function printAssembly(assembly) {
  const verified = componentsOf(assembly).map((component) => ({
    ...component, source: 'listing', sourceSa: assembly.sa, verified: true,
  }));
  const recovered = recoveredComponentsOf(assembly);
  const references = listingReferencesOf(assembly);
  const components = [...verified, ...recovered, ...references];
  const coverage = componentCoverage(assembly);
  const drawing = drawingFor(assembly.sa);
  const roleLabel = {
    exterior: 'Exterior', upperTB: 'Upper T-break',
    lowerTB: 'Lower T-break', interior: 'Interior',
  };

  const componentRows = components.length
    ? components.map((component) => el('tr', {},
        el('td', {}, component.role),
        el('td.mono.print-wo', {}, component.die),
        el('td.mono.num', {}, component.qty > 1 ? `×${component.qty}` : '1'),
        el('td', {}, componentSourceLabel(component))))
    : [el('tr', {}, el('td', { colspan: '4' }, 'No verified extrusion numbers'))];

  const drawingNode = drawing ? el('figure.print-drawing', {},
    el('img', { src: drawing.src, alt: `Section through ${assembly.sa}` }),
    el('figcaption', {}, drawing.source === 'listing'
      ? 'Listing assembly diagram' : 'Dimensioned drawing sheet'))
    : el('div.print-empty.print-drawing-missing', {}, 'Assembly drawing not available');

  const componentMap = el('div', {},
    el('div.print-record-status', {},
      el('b', {}, coverage.complete ? 'Component map complete' : 'Component map needs review'),
      coverage.missingRoles.length ? el('span', {},
        `Unverified: ${coverage.missingRoles.map((role) => roleLabel[role]).join(', ')}`) : null),
    el('table.print-table.print-component-table', {},
      el('thead', {}, el('tr', {},
        ...['Role', 'Extrusion', 'Qty', 'Source'].map((label) => el('th', {}, label)))),
      el('tbody', {}, ...componentRows)));

  const body = el('div.print-engineering-record', {},
    el('div.print-engineering-grid', {}, drawingNode, componentMap),
    assembly.note ? el('div.print-record-note', {}, el('b', {}, 'Listing note'), assembly.note) : null,
    recovered.length || references.length ? el('div.print-provenance', {},
      'Recovered values are cross-referenced from a matching standard, HT or HTX variant. '
      + 'Thermal-break values are never inferred; description references remain unassigned.') : null);

  printDocument({
    title: assembly.sa,
    subtitle: assembly.desc || 'Rolled sub-assembly',
    meta: [`${assembly.series} Series`, drawing
      ? (drawing.source === 'listing' ? 'Listing diagram' : 'Drawing sheet')
      : 'No drawing'],
    body,
  });
}

function printProfile(record) {
  const imageBody = imageMap?.[record.key];
  const usages = componentUsageOf(record.id);
  const body = el('div.print-engineering-record.print-profile-record', {},
    imageBody ? el('figure.print-drawing.print-profile-drawing', {},
      el('img', { src: imagePrefix + imageBody, alt: `Engineering profile card for ${record.id}` }),
      el('figcaption', {}, `${record.series} Series Extrusions master · page ${record.page}`))
      : el('div.print-empty.print-drawing-missing', {}, 'Profile drawing unavailable'),
    el('div.print-stat-grid.print-profile-fields', {},
      ...[
        ['Supplier', record.supplier],
        ['Proposed die', record.proposed],
        ['Final die', record.finalDie],
        ['Status', record.status],
      ].filter(([, value]) => value).map(([label, value]) =>
        el('div', {}, el('b', {}, value), el('span', {}, label)))),
    el('section.print-table-group', {},
      el('h2', {}, 'Used in rolled assemblies', el('span', {}, `${usages.length} usage${usages.length === 1 ? '' : 's'}`)),
      usages.length ? el('table.print-table', {},
        el('thead', {}, el('tr', {},
          ...['Assembly', 'Description', 'Component relationship'].map((label) => el('th', {}, label)))),
        el('tbody', {}, ...usages.map((usage) => el('tr', {},
          el('td.mono.print-wo', {}, usage.assembly.sa),
          el('td', {}, usage.assembly.desc || '—'),
          el('td', {}, usageSourceLabel(usage))))))
        : el('div.print-empty', {}, 'No section-book usage found.')));

  printDocument({
    title: record.id,
    subtitle: record.description || 'Individual extrusion profile',
    meta: [`${record.series} Series`, record.status],
    body,
  });
}

function componentRow(component, chooseProfile) {
  const profiles = lookupExtrusions(component.die);
  const source = componentSourceLabel(component);
  return el('button.diepart' + (component.verified ? '' : '.recovered'), {
    type: 'button',
    title: profiles.length ? `Open extrusion ${component.die}` : `${component.die} has no reviewed master drawing`,
    onclick: profiles.length ? () => chooseProfile(profiles[0]) : null,
    disabled: !profiles.length,
  },
    el('span.diepart-role', {}, component.role),
    el('span.mono.diepart-die', {}, component.die),
    component.qty > 1 ? chip(`×${component.qty}`, 'mute') : null,
    el('span.diepart-source', {}, source),
    profiles.length
      ? icon('chevron', { size: 13, cls: 'diepart-go' })
      : el('span.diepart-missing', {}, 'No profile drawing'));
}

function componentGroup(title, components, chooseProfile, tone = '') {
  if (!components.length) return null;
  return el(`section.die-component-group${tone ? `.${tone}` : ''}`, {},
    el('div.die-component-head', {},
      el('h3', {}, title),
      el('span', {}, `${components.length} item${components.length === 1 ? '' : 's'}`)),
    el('div.dieparts', {}, ...components.map((component) => componentRow(component, chooseProfile))));
}

function assemblyDetail(assembly, chooseAssembly, chooseProfile) {
  const verified = componentsOf(assembly).map((component) => ({
    ...component, source: 'listing', sourceSa: assembly.sa, verified: true,
  }));
  const recovered = recoveredComponentsOf(assembly);
  const references = listingReferencesOf(assembly);
  const coverage = componentCoverage(assembly);
  const dwg = drawingFor(assembly.sa);
  const roleLabel = {
    exterior: 'Exterior', upperTB: 'Upper T-break',
    lowerTB: 'Lower T-break', interior: 'Interior',
  };
  const missing = coverage.missingRoles.map((part) => roleLabel[part]);

  return el('article.diecard.lookup-detail-enter', {},
    el('div.diecard-head', {},
      el('div', {},
        el('div.lookup-kind', {}, icon('rollers', { size: 14 }), 'Rolled assembly'),
        el('span.mono.diecard-sa', {}, assembly.sa),
        assembly.desc ? el('div.diecard-desc', {}, assembly.desc) : null),
      el('span.spacer'),
      el('button.print-action.record-print', {
        type: 'button', title: `Print ${assembly.sa} drawing and component map`,
        onclick: () => printAssembly(assembly),
      }, icon('print', { size: 15 }), el('span', {}, 'Print')),
      chip(`${assembly.series} series`, 'mute')),

    el('div.die-assembly-grid', {},
      dwg ? el('button.diedrawing', {
        type: 'button',
        title: 'Open the assembly drawing',
        onclick: () => modal(`${assembly.sa} assembly drawing`, el('div.extrusion-zoom', {},
          el('img', { src: dwg.src, alt: `Section through ${assembly.sa}` })), { wide: true }),
      },
        el('img', { src: dwg.src, alt: `Section through ${assembly.sa}`, loading: 'lazy' }),
        el('span.drawing-source', {},
          icon('note', { size: 12 }),
          dwg.source === 'listing' ? 'Listing assembly diagram' : 'Dimensioned drawing sheet'))
        : el('div.diedrawing-none', {},
            icon('alert', { size: 15 }),
            el('strong', {}, 'Drawing not available'),
            el('span', {}, 'The component map can still be used.')),

      el('div.die-component-map', {},
        el('div.component-coverage', {},
          el('span.component-coverage-icon', {},
            icon(coverage.complete ? 'check' : coverage.recovered ? 'note' : 'alert', { size: 17 })),
          el('div', {},
            el('strong', {}, coverage.complete
              ? 'Component map complete'
              : coverage.recovered
                ? `${coverage.recovered} field${coverage.recovered === 1 ? '' : 's'} recovered`
                : 'Component map needs review'),
            el('span', {}, coverage.complete
              ? 'All four assembly roles are accounted for.'
              : missing.length
                ? `Still unverified: ${missing.join(', ')}.`
                : 'Listing references are shown without assigning an uncertain role.'))),
        assembly.note ? el('div.banner.warn.lookup-note', {}, el('div', {}, assembly.note)) : null,
        componentGroup('Verified components', verified, chooseProfile),
        componentGroup('Recovered from matching variant', recovered, chooseProfile, 'recovered'),
        componentGroup('Referenced in listing text', references, chooseProfile, 'reference'),
        !verified.length && !recovered.length && !references.length
          ? el('div.empty.die-components-empty', {},
              el('h3', {}, 'No verified extrusion numbers'),
              el('div', {}, 'This assembly remains in the catalogue, but its source row does not identify component profiles.'))
          : null,
        el('div.lookup-provenance', {},
          icon('note', { size: 13 }),
          'Recovered values are cross-referenced from a matching standard, HT or HTX variant; thermal-break values are never inferred.'))),

    (() => {
      const forms = dieForms(assembly.sa);
      const related = lookupDie(forms.part).usedIn.filter((row) => row.sa !== assembly.sa);
      return related.length ? el('section.lookup-where-used', {},
        el('div.die-component-head', {}, el('h3', {}, `Assemblies using ${forms.part}`),
          el('span', {}, `${related.length} found`)),
        el('div.lookup-related-list', {}, ...related.slice(0, 12).map((row) => el('button', {
          type: 'button', onclick: () => chooseAssembly(row),
        }, el('b.mono', {}, row.sa), el('span', {}, row.desc || ''), icon('chevron', { size: 13 }))))) : null;
    })());
}

function profileDetail(record, rerender, chooseAssembly) {
  const body = imageMap?.[record.key];
  if (!imageMap) ensureExtrusionImages(rerender);
  const usages = componentUsageOf(record.id);

  return el('article.extrusion-card.lookup-detail-enter', {},
    el('div.extrusion-card-head', {},
      el('div', {},
        el('div.lookup-kind', {}, icon('extrusion', { size: 14 }), 'Individual extrusion'),
        el('div.mono.extrusion-id', {}, record.id),
        el('div.extrusion-description', {}, record.description || 'Engineering profile')),
      el('span.spacer'),
      el('button.print-action.record-print', {
        type: 'button', disabled: !imageMap,
        title: imageMap ? `Print ${record.id} profile record` : 'Drawing is still loading',
        onclick: () => printProfile(record),
      }, icon('print', { size: 15 }), el('span', {}, 'Print')),
      statusChip(record.status), chip(`${record.series} series`, 'mute')),
    body
      ? el('button.extrusion-drawing', {
          type: 'button', title: 'Open larger drawing', onclick: () => openExtrusionDrawing(record),
        },
          el('img', {
            src: imagePrefix + body,
            alt: `Engineering profile card for ${record.id}`,
            loading: 'lazy',
          }),
          el('span.extrusion-expand', {}, icon('search', { size: 14 }), 'Open larger'))
      : el('div.extrusion-loading', {},
          imageMap ? icon('alert', { size: 17 }) : el('span.spinner', { 'aria-hidden': 'true' }),
          el('span', {}, imageMap ? 'Drawing unavailable' : 'Loading engineering drawing…')),
    el('div.extrusion-fields', {},
      profileField('Supplier', record.supplier),
      profileField('Proposed die', record.proposed),
      profileField('Final die', record.finalDie)),
    el('div.extrusion-source', {}, icon('note', { size: 13 }),
      `${record.series} Series Extrusions master · page ${record.page}`),
    el('section.lookup-where-used.profile-usage', {},
      el('div.die-component-head', {},
        el('h3', {}, 'Used in rolled assemblies'),
        el('span', {}, usages.length
          ? `${usages.length} usage${usages.length === 1 ? '' : 's'}`
          : 'No section-book matches')),
      usages.length ? el('div.lookup-related-list.profile-related-list', {}, ...usages.slice(0, 30).map((usage) => el('button', {
        type: 'button', onclick: () => chooseAssembly(usage.assembly),
      }, el('b.mono', {}, usage.assembly.sa),
      el('span', {}, usage.assembly.desc || ''),
      el('em', {}, usageSourceLabel(usage)),
      icon('chevron', { size: 13 }))))
        : el('p.small.muted', {}, 'The profile has a reviewed master drawing but is not referenced by a parsed sub-assembly row.')));
}

function browseLibrary(showQuery) {
  const counts = extrusionSeriesCounts();
  const audit = componentAudit();
  return el('div.lookup-browse', {},
    el('div.lookup-intro', {},
      el('div.lookup-intro-icon', {}, icon('search', { size: 23 })),
      el('div', {},
        el('h2', {}, 'One search for assemblies and extrusions'),
        el('p', {}, 'Search a schedule die, an individual extrusion, a final die number, supplier, description, or component usage.'))),
    el('div.lookup-library-stats', {},
      el('div', {}, el('b', {}, SUBASSEMBLIES.length.toLocaleString()), el('span', {}, 'rolled assemblies')),
      el('div', {}, el('b', {}, extrusionCount().toLocaleString()), el('span', {}, 'extrusion profiles')),
      el('div', {}, el('b', {}, drawingCount().toLocaleString()), el('span', {}, 'assembly drawings')),
      el('div', {}, el('b', {}, String(audit.recoveredFields)), el('span', {}, 'fields safely recovered'))),
    el('div.lookup-examples', {},
      el('span', {}, 'Try'),
      ...['S80.106', '80-113', 'male mullion', 'S-25422'].map((query) => el('button', {
        type: 'button', onclick: () => showQuery(query),
      }, query))),
    el('section.lookup-series', {},
      el('div.die-component-head', {}, el('h3', {}, 'Browse extrusion masters'),
        el('span', {}, `${counts.size} series`)),
      el('div.extrusion-series-grid', {},
        ...[...counts.entries()].map(([series, count]) => el('button.extrusion-series', {
          type: 'button', onclick: () => showQuery(`series:${series}`),
        }, el('b', {}, series), el('span', {}, `${count.toLocaleString()} profiles`),
        icon('chevron', { size: 14 }))))));
}

function lookupWorkspace({ initial = '', onQuery = () => {}, persist = false } = {}) {
  let filter = persist ? sectionFilter : 'all';
  let selected = persist ? selectedToken : '';
  const wrap = el('div.engineering-lookup.dielookup', {});
  const input = el('input', {
    type: 'search',
    value: initial,
    placeholder: 'Search S80.106, 80-113, mullion, supplier, or final die…',
    'aria-label': 'Search assemblies and individual extrusion drawings',
    autocomplete: 'off', spellcheck: false,
  });
  const filterBar = el('div.lookup-filters', { 'aria-label': 'Engineering result type' });
  const output = el('div.lookup-output', { 'aria-live': 'polite' });

  const remember = () => {
    onQuery(input.value);
    if (persist) { sectionFilter = filter; selectedToken = selected; }
  };

  const choose = (item) => {
    selected = tokenFor(item);
    remember();
    render();
  };
  const chooseAssembly = (assembly) => {
    input.value = assembly.sa;
    selected = `assembly:${assembly.sa}`;
    filter = 'all';
    remember();
    render();
  };
  const chooseProfile = (record) => {
    input.value = record.id;
    selected = `profile:${record.key}`;
    filter = 'all';
    remember();
    render();
  };
  const showQuery = (query) => {
    input.value = query;
    selected = '';
    remember();
    render();
  };

  function renderFilters(counts = null) {
    const choices = [
      ['all', 'All', counts ? counts.assemblyItems.length + counts.profileItems.length : null],
      ['assemblies', 'Assemblies', counts?.assemblyItems.length],
      ['profiles', 'Extrusions', counts?.profileItems.length],
    ];
    filterBar.replaceChildren(...choices.map(([key, label, count]) => el('button', {
      type: 'button',
      'aria-pressed': String(filter === key),
      onclick: () => { filter = key; selected = ''; remember(); render(); },
    }, el('span', {}, label), Number.isFinite(count) ? el('b.mono', {}, String(count)) : null)));
  }

  function render() {
    output.replaceChildren();
    const query = input.value.trim();
    remember();

    if (!query) {
      renderFilters();
      output.append(browseLibrary(showQuery));
      return;
    }

    const matches = collectMatches(query, filter);
    renderFilters(matches);
    if (!matches.items.length) {
      output.append(el('div.empty.lookup-empty', {},
        el('div.empty-icon', {}, icon('search', { size: 26 })),
        el('h3', {}, 'No engineering record found'),
        el('div', {}, `Nothing in the section book or twelve extrusion masters matches “${query}”.`)));
      return;
    }

    if (!matches.items.some((item) => tokenFor(item) === selected)) {
      selected = tokenFor(matches.items[0]);
      remember();
    }
    const active = matches.items.find((item) => tokenFor(item) === selected) || matches.items[0];

    output.append(el('div.lookup-workspace', {},
      el('aside.lookup-match-panel', {},
        el('div.lookup-match-count', {},
          el('strong', {}, `${matches.items.length} result${matches.items.length === 1 ? '' : 's'}`),
          el('span', {}, 'Assemblies and profiles')),
        el('div.lookup-result-list', {}, ...matches.items.map((item) => resultRow(item, selected, choose)))),
      el('div.lookup-detail', {}, active.type === 'assembly'
        ? assemblyDetail(active.assembly, chooseAssembly, chooseProfile)
        : profileDetail(active.record, render, chooseAssembly))));
  }

  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { selected = ''; render(); }, 90);
  });

  wrap.append(
    el('div.lookup-search-line', {},
      el('div.searchwrap.lookup-search.diesearch', { role: 'search' },
        icon('search', { size: 17, cls: 'searchicon' }), input),
      filterBar),
    output);
  render();
  return { body: wrap, input };
}

/** The full engineering-reference workspace, available as one department tool. */
export function renderDies() {
  const { body } = lookupWorkspace({
    initial: sectionQuery,
    onQuery: (query) => { sectionQuery = query; },
    persist: true,
  });

  const head = el('div.centre-head', {},
    el('div.row.centre-title-row', {},
      el('div.centre-ident', {},
        el('span.centre-rail', { 'aria-hidden': 'true' }),
        el('div', {},
          el('h1.centre-title', {}, 'Engineering Lookup'),
          el('div.centre-sub', {},
            'Assemblies, extrusion profiles, drawings and where-used'))),
      el('span.spacer'),
      el('div.centre-stats', {},
        el('div.cstat', {}, el('b', {}, SUBASSEMBLIES.length.toLocaleString()), el('i', {}, 'assemblies')),
        el('div.cstat', {}, el('b', {}, extrusionCount().toLocaleString()), el('i', {}, 'profiles')))));

  return el('div.centre.die-section.engineering-section', {},
    head,
    el('div.die-section-body', {},
      el('section.panel.die-section-panel.engineering-section-panel', {
        'aria-label': 'Unified engineering search',
      }, body)));
}

/** Open the unified page with a known assembly or extrusion selected. */
export function openEngineeringSection(id, go, type = 'auto') {
  sectionQuery = id;
  sectionFilter = 'all';
  if (type === 'assembly' || (type === 'auto' && /^S(?:A)?/i.test(id))) {
    selectedToken = `assembly:${dieForms(id).sa}`;
  } else {
    const record = lookupExtrusions(id)[0];
    selectedToken = record ? `profile:${record.key}` : '';
  }
  go('dies');
}

/** Quick lookup from a production line or the global header. */
export function dieDialog(initial = '') {
  const { body, input } = lookupWorkspace({ initial });
  const dlg = modal('Engineering lookup', body, { wide: true });
  setTimeout(() => input.focus(), 30);
  return dlg;
}
