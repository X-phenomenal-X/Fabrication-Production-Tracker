/* Individual extrusion profiles from the engineering master PDFs.

   This page stays distinct from Die Lookup because an SA die is a rolled
   assembly, while a record here is one source extrusion. The large image map
   is loaded only after someone selects a result, keeping the daily production
   pages light on phones. */

import { el, chip, icon, modal } from '../ui.js';
import {
  lookupExtrusions, searchExtrusions, extrusionCount, extrusionSeriesCounts,
} from '../extrusions.js';

let sectionQuery = '';
let selectedKey = '';
let imageMap = null;
let imagePrefix = '';
let imagePromise = null;

function ensureImages(scheduleRender) {
  if (imageMap || imagePromise) return;
  imagePromise = import('../extrusion-images.js').then((module) => {
    imageMap = module.EXTRUSION_IMAGES;
    imagePrefix = module.EXTRUSION_IMAGE_PREFIX;
    scheduleRender();
  }).catch(() => {
    imageMap = {};
    scheduleRender();
  });
}

function statusChip(status) {
  if (status === 'Active') return chip('Active', 'ok');
  if (status === 'Obsolete') return chip('Obsolete', 'warn');
  return chip(status, 'bad');
}

function openDrawing(record) {
  const src = imageMap?.[record.key];
  if (!src) return;
  modal(`${record.id} · ${record.series} Series`, el('div.extrusion-zoom', {},
    el('img', {
      src: imagePrefix + src,
      alt: `Engineering profile card for ${record.id}`,
    })), { wide: true });
}

function field(label, value) {
  if (!value) return null;
  return el('div.extrusion-field', {},
    el('span', {}, label),
    el('b', {}, value));
}

function detail(record, scheduleRender) {
  const body = imageMap?.[record.key];
  if (!imageMap) ensureImages(scheduleRender);

  return el('article.extrusion-card', {},
    el('div.extrusion-card-head', {},
      el('div', {},
        el('div.mono.extrusion-id', {}, record.id),
        el('div.extrusion-description', {}, record.description || 'Engineering profile')),
      el('span.spacer'),
      statusChip(record.status),
      chip(`${record.series} series`, 'mute')),
    body
      ? el('button.extrusion-drawing', {
          type: 'button',
          title: 'Open larger drawing',
          onclick: () => openDrawing(record),
        },
          el('img', {
            src: imagePrefix + body,
            alt: `Engineering profile card for ${record.id}`,
            loading: 'lazy',
          }),
          el('span.extrusion-expand', {}, icon('search', { size: 14 }), 'Open larger'))
      : el('div.extrusion-loading', {},
          el('span.spinner', { 'aria-hidden': 'true' }),
          el('span', {}, imageMap ? 'Drawing unavailable' : 'Loading drawing…')),
    el('div.extrusion-fields', {},
      field('Supplier', record.supplier),
      field('Proposed die', record.proposed),
      field('Final die', record.finalDie)),
    el('div.extrusion-source', {},
      icon('note', { size: 13 }),
      `${record.series} Series Extrusions master · page ${record.page}`));
}

function resultRow(record, choose) {
  return el('button.extrusion-result' + (record.key === selectedKey ? '.on' : ''), {
    type: 'button',
    onclick: () => choose(record),
  },
    el('span', {},
      el('b.mono', {}, record.id),
      el('small', {}, record.description || `${record.series} Series profile`)),
    statusChip(record.status),
    icon('chevron', { size: 13 }));
}

function emptyLibrary(show) {
  const counts = extrusionSeriesCounts();
  return el('div.extrusion-browse', {},
    el('div.empty.extrusion-intro', {},
      el('div.empty-icon', {}, icon('search', { size: 26 })),
      el('h3', {}, `${extrusionCount().toLocaleString()} extrusion drawings`),
      el('div', {}, 'Search an internal number, description, supplier, proposed number, '
        + 'or final die. Only cells with an actual profile drawing are included.')),
    el('div.extrusion-series-grid', {},
      ...[...counts.entries()].map(([series, count]) => el('button.extrusion-series', {
        type: 'button',
        onclick: () => show(`series:${series}`),
      },
        el('b', {}, series),
        el('span', {}, `${count.toLocaleString()} drawings`),
        icon('chevron', { size: 14 })))));
}

function lookupContent(scheduleRender) {
  const wrap = el('div.extrusion-lookup', {});
  const input = el('input', {
    type: 'search',
    value: sectionQuery,
    placeholder: '80-113, mullion, ExtruDEX, P14929, or S-25422…',
    'aria-label': 'Search individual extrusion drawings',
    autocomplete: 'off',
    spellcheck: false,
  });
  const output = el('div.extrusion-output', {});

  const show = (query) => {
    sectionQuery = query;
    input.value = query;
    selectedKey = '';
    render();
  };
  const choose = (record) => {
    selectedKey = record.key;
    sectionQuery = record.id;
    input.value = record.id;
    render();
  };

  function render() {
    output.replaceChildren();
    const query = input.value.trim();
    if (!query) {
      output.append(emptyLibrary(show));
      return;
    }

    sectionQuery = query;
    const exact = lookupExtrusions(query);
    const matches = exact.length ? exact : searchExtrusions(query);
    if (!matches.length) {
      output.append(el('div.empty', {},
        el('div.empty-icon', {}, icon('search', { size: 26 })),
        el('h3', {}, 'No extrusion drawing found'),
        el('div', {}, `Nothing in the twelve reviewed masters matches “${query}”.`)));
      return;
    }

    const selected = matches.find((record) => record.key === selectedKey) || matches[0];
    selectedKey = selected.key;
    output.append(el('div.extrusion-workspace', {},
      el('aside.extrusion-match-panel', {},
        el('div.extrusion-match-count', {},
          `${matches.length} match${matches.length === 1 ? '' : 'es'}`),
        el('div.extrusion-result-list', {}, ...matches.map((record) => resultRow(record, choose)))),
      el('div.extrusion-detail', {}, detail(selected, scheduleRender))));
  }

  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      selectedKey = '';
      render();
    }, 100);
  });

  wrap.append(
    el('p.small.muted', { style: { marginTop: 0 } },
      'Individual extrusion profiles from the 2000 and 8000–8950 engineering masters. '
      + 'This is separate from rolled SA die assemblies.'),
    el('div.searchwrap.extrusion-search', { role: 'search' },
      icon('search', { size: 16, cls: 'searchicon' }), input),
    output);
  render();
  return wrap;
}

export function openExtrusionSection(id, go) {
  sectionQuery = id;
  selectedKey = '';
  go('extrusions');
}

export function renderExtrusions(scheduleRender) {
  const head = el('div.centre-head', {},
    el('div.row.centre-title-row', {},
      el('div.centre-ident', {},
        el('span.centre-rail', { 'aria-hidden': 'true' }),
        el('div', {},
          el('h1.centre-title', {}, 'Extrusion Lookup'),
          el('div.centre-sub', {},
            'Engineering master profiles', el('span.dot-sep', {}, '·'),
            'individual extrusions only'))),
      el('span.spacer'),
      el('div.centre-stats', {},
        el('div.cstat', {},
          el('b', {}, extrusionCount().toLocaleString()), el('i', {}, 'drawings')),
        el('div.cstat', {}, el('b', {}, '12'), el('i', {}, 'masters')))));

  return el('div.centre.extrusion-section', {},
    head,
    el('div.extrusion-section-body', {},
      el('section.panel.extrusion-section-panel', {
        'aria-label': 'Individual extrusion search',
      }, lookupContent(scheduleRender))));
}
