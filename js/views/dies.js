/* The die lookup: what a rolled die is actually made of.

   Opened from any die on a schedule line, or from the header when someone just
   wants to look one up. It answers two directions, because both get asked:

     "what is S80.106?"        -> exterior, thermal break, interior
     "where does 80-105 go?"   -> every sub-assembly that uses it

   The second is staging's question. The first is everyone else's. */

import { el, chip, icon, toast, modal } from '../ui.js';
import {
  lookupDie, searchDies, componentsOf, dieForms, SUBASSEMBLIES,
} from '../dies.js';

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

function detail(result, open) {
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
      assembly.note ? el('div.banner.warn', { style: { marginTop: '10px' } },
        el('div', {}, assembly.note)) : null,

      componentsOf(assembly).length
        ? el('div.dieparts', {},
            el('div.su-label', {}, 'Rolled from'),
            ...componentsOf(assembly).map((c) => componentRow(c, open)))
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

/** Open the lookup. `initial` is a die to show straight away, if any. */
export function dieDialog(initial = '') {
  let dlg = null;

  const body = el('div.dielookup', {});
  const input = el('input', {
    type: 'search',
    placeholder: 'Die number, or anything from its description…',
    'aria-label': 'Search the section book',
    value: initial || '',
  });
  const results = el('div.dieresults', {});

  const show = (die) => {
    input.value = die;
    render();
  };

  function render() {
    const q = input.value.trim();
    results.replaceChildren();

    if (!q) {
      results.append(el('div.empty', {},
        el('div.empty-icon', {}, icon('search', { size: 26 })),
        el('h3', {}, `${SUBASSEMBLIES.length} sub-assemblies`),
        el('div', {}, 'Type a die number — S80.106 or 80-105 — or part of a '
          + 'description like "male mullion".')));
      return;
    }

    const exact = lookupDie(q);
    if (exact.assembly || exact.usedIn.length) {
      results.append(detail(exact, show));
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
      results.append(detail(exact, show));
    }
  }

  let t = null;
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(render, 120);
  });

  body.append(
    el('p.small.muted', { style: { marginTop: 0 } },
      'From the Sub-Assembly Section Book. A rolled die is an exterior, an '
      + 'interior and a thermal break top and bottom.'),
    el('div.searchwrap.diesearch', {},
      icon('search', { size: 16, cls: 'searchicon' }),
      input),
    results);

  render();
  dlg = modal('Die lookup', body, { wide: true });
  setTimeout(() => input.focus(), 30);
  return dlg;
}
