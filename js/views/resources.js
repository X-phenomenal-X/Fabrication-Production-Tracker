/* Controlled department forms and travelers. Files live beside the app so
   they can be opened directly and cached by the service worker after first
   use without making every device download the full library at startup. */

import { el, icon } from '../ui.js';
import { printBlankShiftUpdate } from './shiftupdate.js';

const CATEGORIES = [
  { key: 'all', label: 'All', icon: 'list' },
  { key: 'production', label: 'Production', icon: 'factory' },
  { key: 'people', label: 'People & HR', icon: 'users' },
  { key: 'safety', label: 'Safety', icon: 'alert' },
  { key: 'travelers', label: 'Job Travelers', icon: 'job' },
  { key: 'guides', label: 'IT & Guides', icon: 'note' },
];

const FORMS = [
  {
    key: 'cutting-production', category: 'production', tone: 'work',
    title: 'Cutting Production Form',
    description: 'Two-page department production record covering each cutting work centre.',
    file: 'cutting-production-form.pdf', meta: ['PDF', '2 pages', 'Print-ready'],
  },
  {
    key: 'fom-vent', category: 'production', tone: 'work',
    title: 'FOM Vent Machining Checklist',
    description: 'Feature-by-feature FOM vent inspection and machining sign-off.',
    file: 'fom-vent-machining-checklist.pdf', meta: ['PDF', '1 page', 'Print-ready'],
  },
  {
    key: 'operations-signoff', category: 'production', tone: 'work',
    title: 'Cutting Operations Sign-Off',
    description: 'Training sign-off sheet for Cutting Department operational instruction.',
    file: 'cutting-operations-sign-off.pdf', meta: ['PDF', '1 page', 'Sign-off'],
  },
  {
    key: 'quality-alert', category: 'production', tone: 'work',
    title: 'Quality Alert Sign-Off',
    description: 'Print-name, clock-number, signature and date acknowledgement sheet.',
    file: 'quality-alert-sign-off-sheet.pdf', meta: ['PDF', '1 page', 'Print-ready'],
  },
  {
    key: 'shift-update', category: 'production', tone: 'work',
    title: 'Blank Shift Update',
    description: 'Generate a clean Day or Afternoon machine handoff sheet to complete by hand.',
    action: 'print-shift', meta: ['In app', 'Blank form', 'Print / save PDF'],
  },
  {
    key: 'personal-information', category: 'people', tone: 'people',
    title: 'Personal Information Form',
    description: 'Employee personal, emergency-contact, vehicle and office-use information.',
    file: 'personal-information-form-sep-2024.pdf', meta: ['PDF', 'Sep 2024', '1 page'],
  },
  {
    key: 'coaching', category: 'people', tone: 'people',
    title: 'Employee Coaching Form',
    description: 'Supervisor coaching record, expectations, acknowledgement and signatures.',
    file: 'employee-coaching-form.pdf', meta: ['PDF', '1 page', 'Signatures'],
  },
  {
    key: 'discipline', category: 'people', tone: 'people',
    title: 'Discipline Letter — Supervisor Input',
    description: 'Editable information sheet for a supervisor requesting a discipline letter.',
    file: 'discipline-letter-supervisor-input.docx', meta: ['Word', 'Editable', '1 page'],
  },
  {
    key: 'payroll', category: 'people', tone: 'people',
    title: 'Payroll Adjustment Form',
    description: 'Record missed hours, premiums, deductions, benefits and approval details.',
    file: 'payroll-adjustment-form.pdf', meta: ['PDF', '1 page', 'Print-ready'],
  },
  {
    key: 'time-off-office', category: 'people', tone: 'people',
    title: 'Time-Off Request — Office / Non-Union',
    description: 'Office and non-union vacation or other time-off request and approval form.',
    file: 'time-off-request-office-non-union.pdf', meta: ['PDF', 'Office staff', '1 page'],
  },
  {
    key: 'time-off-plant', category: 'people', tone: 'people',
    title: 'Time-Off Request — Plant / Union',
    description: 'Residential plant union vacation or other time-off request and approval form.',
    file: 'time-off-request-plant-union.pdf', meta: ['PDF', 'Plant staff', '1 page'],
  },
  {
    key: 'orientation', category: 'safety', tone: 'safety',
    title: 'Worker Health & Safety Orientation',
    description: 'Two-part worker orientation and department-specific safety checklist.',
    file: 'worker-health-safety-orientation-checklist.pdf', meta: ['PDF', '2 pages', 'Nov 2024'],
  },
  {
    key: 'incident', category: 'safety', tone: 'safety',
    title: 'Incident & Investigation Report',
    description: 'F19 incident details, injury assessment, investigation and corrective actions.',
    file: 'f19-incident-investigation-report.pdf', meta: ['PDF', 'F19', '3 pages'],
  },
  {
    key: '8700-traveler', category: 'travelers', tone: 'travelers',
    title: '8700 Sash Job Traveler',
    description: 'Hollow-metal and FOM processing traveler for 8700 sash work.',
    file: '8700-sash-job-traveler.pdf', meta: ['PDF', '8700', '1 page'],
  },
  {
    key: '8710-traveler', category: 'travelers', tone: 'travelers',
    title: '8710 Sash Job Traveler',
    description: 'Hollow-metal and FOM processing traveler for 8710 sash work.',
    file: '8710-sash-job-traveler.pdf', meta: ['PDF', '8710', '1 page'],
  },
  {
    key: 'frame-traveler', category: 'travelers', tone: 'travelers',
    title: 'Frame Job Traveler',
    description: 'Project, floor, quantity, series, colour and cart traveler for frames.',
    file: 'frame-job-traveler.pdf', meta: ['PDF', 'Frames', '1 page'],
  },
  {
    key: 'prep-traveler', category: 'travelers', tone: 'travelers',
    title: 'Prep Job Traveler',
    description: 'Cutting and panel preparation completion traveler.',
    file: 'prep-job-traveler.pdf', meta: ['PDF', 'Prep', '1 page'],
  },
  {
    key: 'project-travelers', category: 'travelers', tone: 'travelers',
    title: 'Project Colour Travelers',
    description: 'Seven editable project travelers with job codes and colour bands.',
    file: 'project-travellers.pptx', meta: ['PowerPoint', 'Editable', '7 slides'],
  },
  {
    key: 'pulled-material', category: 'travelers', tone: 'travelers',
    title: 'Pulled Material Traveler',
    description: 'Project, floor, skid, colour, date and material-type traveler.',
    file: 'pulled-material-traveler.pdf', meta: ['PDF', 'Material', '1 page'],
  },
  {
    key: 'quest-traveler', category: 'travelers', tone: 'travelers',
    title: 'Quest Job Traveler',
    description: 'Project, part, floor and interior/exterior colour traveler for Quest work.',
    file: 'quest-job-traveler.pdf', meta: ['PDF', 'Quest', '1 page'],
  },
  {
    key: 'service-order', category: 'travelers', tone: 'travelers',
    title: 'Service Order',
    description: 'Compact job name, service work-order number and date traveler.',
    file: 'service-order.pdf', meta: ['PDF', 'Service', '1 page'],
  },
  {
    key: 'ets-service-desk', category: 'guides', tone: 'guides',
    title: 'ETS Service Desk Submission Tutorial',
    description: 'Email, phone, agent and web-portal methods for requesting IT support.',
    file: 'ets-service-desk-tutorial-dec-2024.pdf', meta: ['PDF', 'Dec 2024', '10 pages'],
  },
];

const view = { category: 'production', query: '' };

function categoryFor(key) {
  return CATEGORIES.find((category) => category.key === key) || CATEGORIES[0];
}

function formCard(form) {
  const category = categoryFor(form.category);
  const search = [form.title, form.description, category.label, ...(form.meta || [])]
    .join(' ').toLowerCase();
  const action = form.action === 'print-shift'
    ? el('button.primary.resource-download', {
        type: 'button',
        'aria-label': 'Print a blank shift update form',
        onclick: printBlankShiftUpdate,
      }, icon('print', { size: 18 }), el('span', {}, 'Print blank form'))
    : el('a.primary.resource-download', {
        href: `assets/forms/official/${form.file}`,
        target: '_blank',
        rel: 'noopener',
        download: form.file,
        'aria-label': `Open or download ${form.title}`,
      }, icon('download', { size: 18 }), el('span', {}, 'Open / download'));

  return el(`article.resource-card.${form.tone}`, {
    'data-category': form.category,
    'data-search': search,
  },
    el('div.resource-card-top', {},
      el('span.resource-icon', { 'aria-hidden': 'true' }, icon(category.icon, { size: 25 })),
      el('div.resource-card-copy', {},
        el('div.resource-kicker', {}, category.label),
        el('h2', {}, form.title),
        el('p', {}, form.description))),
    el('div.resource-meta', {}, ...(form.meta || []).map((item) => el('span', {}, item))),
    action);
}

export function renderResources() {
  const cardNodes = FORMS.map(formCard);
  const resultTitle = el('h2', {});
  const resultCount = el('span.resource-result-count.mono', {});
  const empty = el('div.empty.resource-empty', { hidden: true },
    el('div.empty-icon', {}, icon('search', { size: 26 })),
    el('h3', {}, 'No matching form'),
    el('p', {}, 'Try a shorter form name, job traveler, or file type.'));
  const grid = el('div.resource-grid', {}, ...cardNodes);
  let searchInput;
  let categoryButtons;

  function applyFilter() {
    const query = view.query.trim().toLowerCase();
    let shown = 0;
    cardNodes.forEach((card) => {
      const categoryMatch = view.category === 'all' || card.dataset.category === view.category;
      const queryMatch = !query || card.dataset.search.includes(query);
      const visible = query ? queryMatch : categoryMatch;
      card.hidden = !visible;
      if (visible) shown += 1;
    });
    categoryButtons.forEach((button) => {
      const selected = button.dataset.category === view.category;
      button.classList.toggle('on', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    const selected = categoryFor(view.category);
    resultTitle.textContent = query ? 'Search results' : selected.key === 'all' ? 'All forms' : selected.label;
    resultCount.textContent = `${shown} ${shown === 1 ? 'item' : 'items'}`;
    empty.hidden = shown !== 0;
    grid.hidden = shown === 0;
  }

  searchInput = el('input', {
    type: 'search',
    value: view.query,
    placeholder: 'Search forms, travelers or file types',
    'aria-label': 'Search the forms library',
    oninput: (event) => { view.query = event.target.value; applyFilter(); },
  });
  categoryButtons = CATEGORIES.map((category) => {
    const count = category.key === 'all'
      ? FORMS.length
      : FORMS.filter((form) => form.category === category.key).length;
    return el('button.resource-category', {
      type: 'button',
      'data-category': category.key,
      'aria-pressed': 'false',
      onclick: () => {
        view.category = category.key;
        view.query = '';
        searchInput.value = '';
        applyFilter();
      },
    }, icon(category.icon, { size: 17 }), el('span', {}, category.label), el('b.mono', {}, String(count)));
  });

  const page = el('div.centre.resource-centre', {},
    el('div.centre-head', {},
      el('div.row.centre-title-row', {},
        el('div.centre-ident', {},
          el('span.centre-rail', { 'aria-hidden': 'true' }),
          el('div', {},
            el('h1.centre-title', {}, 'Forms & job travelers'),
            el('div.centre-sub', {}, `${FORMS.length - 1} approved downloads · one blank Shift Update print action`))))),

    el('section.panel.resource-command', { 'aria-label': 'Find a form' },
      el('label.resource-search', {},
        el('span', {}, 'Find a form'),
        el('span.resource-search-input', {}, icon('search', { size: 18 }), searchInput)),
      el('div.resource-categories', { role: 'group', 'aria-label': 'Form categories' }, ...categoryButtons)),

    el('div.resource-notice', {},
      icon('alert', { size: 18 }),
      el('div', {},
        el('strong', {}, 'Controlled department library'),
        el('p', {}, 'Download a fresh copy for each use and confirm the revision printed on the form. '
          + 'Emergency, incident and HR procedures still follow company policy.'))),

    el('section.resource-results', { 'aria-live': 'polite' },
      el('div.resource-results-head', {}, resultTitle, resultCount),
      grid,
      empty),

    el('div.resource-footnote', {},
      icon('cloud', { size: 16 }),
      el('span', {}, 'Downloads stay on demand. A file becomes available offline on this device after it has been opened once.')));

  applyFilter();
  return page;
}
