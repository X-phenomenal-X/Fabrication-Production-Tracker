/* Department forms: small, controlled download surface for the blank records
   people reach for during a shift. The PDFs live beside the app so a browser
   can open them directly and the service worker can cache one after it is
   first used, without making every first visit download every form. */

import { el, icon } from '../ui.js';

const FORMS = [
  {
    key: 'production',
    title: 'Production Activity Record',
    description: 'Blank machine and shift record for work orders, dies, quantities, downtime and closeout.',
    file: 'bv-production-activity-record.pdf',
    pages: 1,
    tone: 'work',
  },
  {
    key: 'incident',
    title: 'Incident Reporting Form',
    description: 'Capture the people, location, event, immediate response, witnesses and follow-up actions.',
    file: 'bv-incident-report-form.pdf',
    pages: 2,
    tone: 'bad',
  },
  {
    key: 'orientation',
    title: 'Worker Orientation Checklist',
    description: 'Document site, safety, emergency, PPE, equipment and supervisor orientation topics.',
    file: 'bv-worker-orientation-checklist.pdf',
    pages: 2,
    tone: 'ok',
  },
];

function formCard(form) {
  const href = `assets/forms/${form.file}`;
  return el(`article.resource-card.${form.tone}`, {},
    el('div.resource-card-top', {},
      el('span.resource-icon', { 'aria-hidden': 'true' }, icon('file', { size: 26 })),
      el('div.resource-card-copy', {},
        el('div.resource-kicker', {}, form.key === 'incident' ? 'Safety record' : 'Production form'),
        el('h2', {}, form.title),
        el('p', {}, form.description))),
    el('div.resource-meta', {},
      el('span', {}, 'Fillable PDF'),
      el('span', {}, `${form.pages} page${form.pages === 1 ? '' : 's'}`),
      el('span', {}, 'Print-ready')),
    el('a.primary.resource-download', {
      href,
      target: '_blank',
      rel: 'noopener',
      download: form.file,
      'aria-label': `Open or download the blank ${form.title}`,
    }, icon('download', { size: 18 }), el('span', {}, 'Open / download')));
}

export function renderResources() {
  return el('div.centre.resource-centre', {},
    el('div.centre-head', {},
      el('div.row.centre-title-row', {},
        el('div.centre-ident', {},
          el('span.centre-rail', { 'aria-hidden': 'true' }),
          el('div', {},
            el('h1.centre-title', {}, 'Forms'),
            el('div.centre-sub', {}, 'Blank department records, ready to fill or print'))))),

    el('div.resource-notice', {},
      icon('alert', { size: 18 }),
      el('div', {},
        el('strong', {}, 'Internal blank templates'),
        el('p', {}, 'Use an approved controlled company form or emergency process whenever one applies. '
          + 'These tracker templates do not replace policy, medical attention or emergency reporting.'))),

    el('div.resource-grid', {}, ...FORMS.map(formCard)),

    el('div.resource-footnote', {},
      icon('cloud', { size: 16 }),
      el('span', {}, 'A form becomes available offline on this device after it has been opened once.')));
}
