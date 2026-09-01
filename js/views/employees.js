/* A light employee directory built from the names already stored in tracker
   state. No roster or personal details are shipped in the public website: the
   list is populated by the department and follows the same sync path as the
   operator picker in the header. */

import { el, icon, toast } from '../ui.js';
import { state, save, me } from '../store.js';

const view = { q: '' };

function cleanName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function initials(name) {
  const parts = cleanName(name).split(' ').filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts.at(-1)[0] : parts[0]?.slice(0, 2) || '?').toUpperCase();
}

function employeeCard(name, rerender) {
  const current = state.settings.me === name;
  return el('article.employee-card' + (current ? '.current' : ''), {},
    el('span.employee-avatar', { 'aria-hidden': 'true' }, initials(name)),
    el('div.employee-name', {},
      el('strong', {}, name),
      el('span', {}, current ? 'Current device operator' : 'Cutting department')),
    current
      ? el('span.employee-current', {}, icon('check', { size: 15 }), 'This device')
      : el('button.employee-use', {
          type: 'button',
          'aria-label': `Use this device as ${name}`,
          onclick: () => {
            state.settings.me = name;
            save();
            toast(`This device is now set to ${name}`);
            rerender();
          },
        }, 'Use this device'));
}

export function renderEmployees(rerender) {
  const people = [...new Set((state.people || []).map(cleanName).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  const query = view.q.trim().toLowerCase();
  const shown = query ? people.filter((name) => name.toLowerCase().includes(query)) : people;
  const name = el('input', {
    type: 'text',
    autocomplete: 'name',
    placeholder: 'Employee name',
    'aria-label': 'New employee name',
  });

  const add = () => {
    const next = cleanName(name.value);
    if (!next) return;
    const existing = people.find((person) => person.toLowerCase() === next.toLowerCase());
    if (existing) {
      toast(`${existing} is already on the list`);
      name.value = '';
      return;
    }
    state.people.push(next);
    save();
    toast(`${next} added`);
    rerender();
  };

  return el('div.centre.employees-page', {},
    el('div.centre-head', {},
      el('div.row.centre-title-row', {},
        el('div.centre-ident', {},
          el('span.centre-rail', { 'aria-hidden': 'true' }),
          el('div', {},
            el('h1.centre-title', {}, 'Employees'),
            el('div.centre-sub', {}, `${people.length} department name${people.length === 1 ? '' : 's'} · this device: ${me()}`))))),

    el('section.panel.employee-tools', {},
      el('header', {}, icon('users', { size: 17 }), el('h2', {}, 'Department list')),
      el('div.body.employee-toolbar', {},
        el('label.employee-search', {},
          el('span', {}, 'Find an employee'),
          el('span.employee-input', {}, icon('search', { size: 17 }),
            el('input', {
              type: 'search',
              value: view.q,
              placeholder: 'Search names',
              oninput: (event) => { view.q = event.target.value; rerender(); },
            }))),
        el('form.employee-add', {
          onsubmit: (event) => { event.preventDefault(); add(); },
        },
          el('label', {}, el('span', {}, 'Add to the list'), name),
          el('button.primary', { type: 'submit' }, icon('plus', { size: 17 }), 'Add employee')))),

    people.length
      ? el('div.employee-grid', {},
          ...shown.map((person) => employeeCard(person, rerender)),
          !shown.length ? el('div.empty.employee-empty', {},
            el('h3', {}, 'No matching employee'),
            el('p', {}, 'Try a shorter name or clear the search.')) : null)
      : el('div.panel', {}, el('div.empty', {},
          el('div.empty-icon', {}, icon('users', { size: 28 })),
          el('h3', {}, 'No employee names yet'),
          el('p', {}, 'Add a name above. It will also appear in the operator picker and assignment fields.'))),

    el('div.employee-privacy', {},
      icon('cloud', { size: 16 }),
      el('span', {}, 'Names use the tracker’s existing local/shared state. No employee roster is built into the public app files.')));
}
