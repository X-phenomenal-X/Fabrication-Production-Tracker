/* The die lookup: what a rolled die is actually made of.

   Opened from any die on a schedule line, or from the header when someone just
   wants to look one up. It answers two directions, because both get asked:

     "what is S80.106?"        -> exterior, thermal break, interior
     "where does 80-105 go?"   -> every sub-assembly that uses it

   The second is staging's question. The first is everyone else's. */

import { el, chip, icon, modal } from '../ui.js';
import {
  lookupDie, searchDies, componentsOf, SUBASSEMBLIES,
} from '../dies.js';
import { drawingFor, drawingCount } from '../die-drawings.js';
import { openExtrusionSection } from './extrusions.js';

let sectionQuery = '';

function componentRow(c, open) {
  return el('button.diepart', {
    title: `Look up ${c.die}`,
    onclick: () => open(c.die),
  },
    el('span.diepart-role', {}, c.role),
    el('span.mono.diepart-die', {}, c.die),
    c.qty > 1 ? chip(`×${c.qty}`, 'mute') : null,
    c.note ? el('span.small.muted', {}, c.note) : null,
    icon('chevron', { size: 13, cls: 'diepart-go' }));
}

function detail(result, open, openComponent = open) {
  const { assembly, usedIn, forms } = result;

  if (!assembly && !usedIn.length) {
    return el('div.empty', {},
      el('div.empty-icon', {}, icon('search', { size: 26 })),
      el('h3', {}, 'Not in the section book'),
      el('div', {}, `Nothing found for ${forms.sa || result.input}. The book covers `
        + 'the 8000 to 8950 series sub-assemblies; a hardware or accessory part '
        + 'will not be in it.'));
  }

  return el('div', {},
    assembly ? el('div.diecard', {},
      el('div.diecard-head', {},
        el('span.mono.diecard-sa', {}, assembly.sa),
        el('span.spacer'),
        chip(assembly.series + ' series', 'mute')),
      assembly.desc ? el('div.diecard-desc', {}, assembly.desc) : null,

      // The section through the assembled profile, with every component called
      // out where it sits. The listing tells you 80-113 is the exterior; this
      // tells you which piece that is on the rack.
      (() => {
        const dwg = drawingFor(assembly.sa);
        if (!dwg) {
          return el('div.diedrawing-none', {},
            icon('alert', { size: 14 }),
            el('span', {}, 'No drawing for this one yet.'));
        }
        return el('div.diedrawing', {},
          el('img', {
            src: dwg.src,
            alt: `Section through ${assembly.sa}`,
            loading: 'lazy',
          }),
          dwg.source === 'listing'
            ? el('div.diedrawing-cap', {},
                icon('note', { size: 12 }),
                el('span', {}, 'Assembly diagram from the listing — profile only, '
                  + 'no dimensions or callouts.'))
            : null);
      })(),
      assembly.note ? el('div.banner.warn', { style: { marginTop: '10px' } },
        el('div', {}, assembly.note)) : null,

      componentsOf(assembly).length
        ? el('div.dieparts', {},
            el('div.su-label', {}, 'Rolled from'),
            ...componentsOf(assembly).map((c) => componentRow(c, openComponent)))
        : el('div.small.muted', { style: { marginTop: '10px' } },
            'The book lists no component extrusions against this one.')) : null,

    usedIn.length ? el('div.dieused', {},
      el('div.su-label', {}, `${forms.part} goes into ${usedIn.length} `
        + `sub-assembl${usedIn.length === 1 ? 'y' : 'ies'}`),
      el('div.dieused-list', {}, ...usedIn.slice(0, 40).map((r) => el('button.dieused-row', {
        onclick: () => open(r.sa),
      },
        el('span.mono.strong', {}, r.sa),
        el('span.small.muted', {}, r.desc || ''),
        icon('chevron', { size: 13 })))),
      usedIn.length > 40
        ? el('div.small.muted', {}, `and ${usedIn.length - 40} more`) : null) : null);
}

function lookupContent(initial = '', onQuery = () => {}, openComponent = null) {
  const body = el('div.dielookup', {});
  const input = el('input', {
    type: 'search',
    placeholder: 'S80.106, SA80.106, component, or description…',
    'aria-label': 'Search the section book',
    value: initial || '',
    autocomplete: 'off',
    spellcheck: false,
  });
  const results = el('div.dieresults', {});

  const show = (die) => {
    input.value = die;
    onQuery(die);
    render();
  };

  function render() {
    const q = input.value.trim();
    results.replaceChildren();

    if (!q) {
      results.append(el('div.empty', {},
        el('div.empty-icon', {}, icon('search', { size: 26 })),
        el('h3', {}, `${SUBASSEMBLIES.length} sub-assemblies`),
        el('div', {}, 'Type a schedule number like S80.106, its section-book '
          + 'form SA80.106 or SA80-106, a component like 80-105, or part of a '
          + 'description like "male mullion".')));
      return;
    }

    const exact = lookupDie(q);
    if (exact.assembly || exact.usedIn.length) {
      results.append(detail(exact, show, openComponent || show));
    }

    // Anything else that matches, so a partial number or a description still
    // gets somewhere.
    const others = searchDies(q).filter((r) => r.sa !== exact.assembly?.sa);
    if (others.length) {
      results.append(el('div.dieother', {},
        el('div.su-label', {}, exact.assembly ? 'Other matches' : `${others.length} matches`),
        ...others.slice(0, 30).map((r) => el('button.dieused-row', {
          onclick: () => show(r.sa),
        },
          el('span.mono.strong', {}, r.sa),
          el('span.small.muted', {}, r.desc || ''),
          icon('chevron', { size: 13 })))));
    }

    if (!exact.assembly && !exact.usedIn.length && !others.length) {
      results.append(detail(exact, show, openComponent || show));
    }
  }

  let t = null;
  input.addEventListener('input', () => {
    onQuery(input.value);
    clearTimeout(t);
    t = setTimeout(render, 120);
  });

  body.append(
    el('p.small.muted', { style: { marginTop: 0 } },
      'From the Sub-Assembly Section Book. A rolled die is an exterior, an '
      + 'interior and a thermal break top and bottom. Schedule and book '
      + 'spellings return the same assembly.'),
    el('div.searchwrap.diesearch', { role: 'search' },
      icon('search', { size: 16, cls: 'searchicon' }),
      input),
    results);

  render();
  return { body, input };
}

/** The full section-book workspace, available as a department tool. */
export function renderDies(_scheduleRender, go) {
  const { body } = lookupContent(sectionQuery, (q) => { sectionQuery = q; },
    (id) => openExtrusionSection(id, go));

  const head = el('div.centre-head', {},
    el('div.row.centre-title-row', {},
      el('div.centre-ident', {},
        el('span.centre-rail', { 'aria-hidden': 'true' }),
        el('div', {},
          el('h1.centre-title', {}, 'Die Lookup'),
          el('div.centre-sub', {},
            'Sub-Assembly Section Book',
            el('span.dot-sep', {}, '·'),
            'profiles, components and where-used'))),
      el('span.spacer'),
      el('div.centre-stats', {},
        el('div.cstat', {},
          el('b', {}, SUBASSEMBLIES.length.toLocaleString()), el('i', {}, 'assemblies')),
        el('div.cstat', {},
          el('b', {}, drawingCount().toLocaleString()), el('i', {}, 'drawings')))));

  return el('div.centre.die-section', {},
    head,
    el('div.die-section-body', {},
      el('section.panel.die-section-panel', { 'aria-label': 'Section book search' }, body)));
}

/** Open the quick lookup. `initial` is a die to show straight away, if any. */
export function dieDialog(initial = '') {
  const { body, input } = lookupContent(initial);
  const dlg = modal('Die lookup', body, { wide: true });
  setTimeout(() => input.focus(), 30);
  return dlg;
}
