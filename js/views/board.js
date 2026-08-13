/* The board: every order Cutting cares about, filterable, with per-operation
   progress entry. This is the screen that replaces squinting at 148 columns. */

import { el, clear, chip, bar, fmtDate, fmtNum, fmtWhen, modal, toast } from '../ui.js';
import { state, setProgress, clearProgress, setMaterial, historyFor, me } from '../store.js';
import {
  activeOrders, rollup, riskOf, reasonFor, RISK, cutTone, purchTone, today, progressFor,
  profileRollup, completion, materialState,
} from '../model.js';
import { CUT_STATUS } from '../schema.js';
import { MATERIAL, MATERIAL_ORDER } from '../profiles.js';

const filters = {
  q: '',
  risk: 'ALL',
  project: 'ALL',
  section: 'ALL',
  sort: 'urgency',
};

function matches(o, risk) {
  if (filters.risk !== 'ALL' && risk.key !== filters.risk) return false;
  if (filters.project !== 'ALL' && (o.project || '—') !== filters.project) return false;
  if (filters.section !== 'ALL' && (o.section || '—') !== filters.section) return false;
  if (filters.q) {
    const hay = [o.wo, o.job, o.project, o.floor, o.notes, o.series, o.extStatus]
      .filter(Boolean).join(' ').toLowerCase();
    if (!hay.includes(filters.q.toLowerCase())) return false;
  }
  return true;
}

function rows() {
  const ref = today();
  const out = [];
  for (const o of activeOrders()) {
    const risk = riskOf(o, ref);
    if (!matches(o, risk)) continue;
    out.push({ order: o, risk, roll: rollup(o) });
  }
  const sorters = {
    urgency: (a, b) => a.risk.rank - b.risk.rank ||
      ((a.order.cuttingDate || a.order.shipDate || '9999') < (b.order.cuttingDate || b.order.shipDate || '9999') ? -1 : 1),
    ship: (a, b) => (a.order.shipDate || '9999') < (b.order.shipDate || '9999') ? -1 : 1,
    cutdate: (a, b) => (a.order.cuttingDate || '9999') < (b.order.cuttingDate || '9999') ? -1 : 1,
    pieces: (a, b) => b.roll.remaining - a.roll.remaining,
    project: (a, b) => String(a.order.project || '').localeCompare(String(b.order.project || '')),
  };
  return out.sort(sorters[filters.sort] || sorters.urgency);
}

/* ---------- order detail ---------- */

const HISTORY_LABEL = {
  cut: 'Cut',
  material: 'Material',
};

function historyPanel(order) {
  const rows = historyFor(order.id);
  if (!rows.length) {
    return el('div', { style: { marginTop: '16px' } },
      el('h4', { style: { margin: '0 0 6px', fontSize: '13px' } }, 'History'),
      el('div.small.muted', {}, 'Nothing recorded yet. Every change made here is logged with who and when.'));
  }
  return el('div', { style: { marginTop: '16px' } },
    el('h4', { style: { margin: '0 0 6px', fontSize: '13px' } }, `History (${rows.length})`),
    el('ul.list', { style: { border: '1px solid var(--line-soft)', borderRadius: '8px', maxHeight: '220px', overflow: 'auto' } },
      ...rows.slice(0, 80).map((h) => {
        const [kind, key] = String(h.kind).split(':');
        const shown = (v) => v == null ? '—' : (MATERIAL[v]?.label || String(v));
        return el('li', { style: { padding: '7px 12px' } },
          el('div.row.small', { style: { gap: '8px' } },
            el('strong', {}, HISTORY_LABEL[kind] || kind),
            el('span.muted', {}, key || ''),
            el('span', {}, shown(h.from), ' → ', el('strong', {}, shown(h.to))),
            el('span.spacer'),
            el('span.muted.nowrap', {}, `${h.by} · ${fmtWhen(h.at)}`)),
          h.note ? el('div.small.muted', {}, h.note) : null);
      })));
}

export function openOrder(order, rerender) {

  const opsBox = el('div');
  const histBox = el('div');

  const renderHistory = () => {
    histBox.replaceChildren(historyPanel(order));
  };

  const renderOps = () => {
    clear(opsBox);
    renderHistory();
    const comp = completion(order);

    // Headline: order completion is what the department is judged on.
    opsBox.append(el('div.row', {
      style: { marginBottom: '14px', alignItems: 'baseline', gap: '10px' },
    },
      el('span', { style: { fontSize: '26px', fontWeight: '700', letterSpacing: '-.02em' } },
        comp.pct == null ? '—' : comp.pct + '%'),
      el('span.small.muted', {}, comp.target
        ? `${fmtNum(comp.done)} of ${fmtNum(comp.target)} pieces · ${comp.profilesDone}/${comp.profiles} profiles complete`
        : 'no piece counts on this order'),
      el('span.spacer'),
      comp.complete ? chip('Order complete', 'ok') : null,
      comp.blockedProfiles.length
        ? chip(`${comp.blockedProfiles.length} profile${comp.blockedProfiles.length === 1 ? '' : 's'} waiting on material`, 'bad')
        : null));

    if (comp.target) {
      opsBox.append(el('div', { style: { marginBottom: '16px' } }, bar(comp.pct, comp.complete)));
    }

    for (const row of comp.rows) {
      const p = row.profile;

      const matSelect = el('select', {
        style: { maxWidth: '150px' },
        onchange: (e) => {
          setMaterial(order.id, p.key, e.target.value || null);
          requestAnimationFrame(renderOps);
        },
      },
        el('option', { value: '', selected: !row.material.status }, 'Not set'),
        ...MATERIAL_ORDER.map((k) => el('option', {
          value: k, selected: row.material.status === k,
        }, MATERIAL[k].label)));

      const header = el('div.row', { style: { gap: '10px', marginBottom: '6px' } },
        el('strong', { style: { minWidth: '120px' } }, p.label),
        row.target
          ? el('span.row', { style: { gap: '8px', flexWrap: 'nowrap', flex: '1' } },
              bar(row.pct, row.complete),
              el('span.mono.small.nowrap', {}, `${fmtNum(row.done)}/${fmtNum(row.target)}`))
          : el('span.small.muted', { style: { flex: '1' } }, 'no piece count'),
        el('span.small.muted.hide-sm', {}, 'Material'),
        matSelect,
        row.material.status && !row.material.explicit
          ? chip('from schedule', 'mute', 'Taken from the order-level material column; set it here to override')
          : null,
        row.material.status
          ? chip(MATERIAL[row.material.status].label, MATERIAL[row.material.status].tone)
          : null);

      const opRows = row.ops.map((op) => {
        const pr = progressFor(order.id, op.key);
        const input = el('input', {
          type: 'number', min: '0', max: String(op.target), value: op.done || '',
          placeholder: '0', inputmode: 'numeric',
        });
        const commit = (v) => {
          const n = v === '' ? null : Math.max(0, Math.min(op.target, Number(v)));
          if (n == null) clearProgress(order.id, op.key);
          else setProgress(order.id, op.key, n);
          requestAnimationFrame(renderOps);
        };
        input.addEventListener('change', () => commit(input.value));
        return el('div.oprow', {},
          el('span.oplabel', { title: op.alt || '' }, op.label),
          el('span.opinput', {}, input),
          el('span.opqty', {}, `/ ${fmtNum(op.target)}`),
          bar(op.target ? (op.done / op.target) * 100 : 0, op.complete),
          el('button.sm.ghost', {
            title: 'Mark this operation fully cut',
            onclick: () => commit(String(op.target)),
          }, 'All'),
          pr?.by ? el('span.small.muted.nowrap.hide-sm', {}, `${pr.by} · ${fmtWhen(pr.at)}`) : null);
      });

      opsBox.append(el('div', {
        style: {
          padding: '10px 0', borderTop: '1px solid var(--line-soft)',
        },
      }, header, ...opRows));
    }

    // Status-only operations (BD Prep, MTL STATUS) sit outside the profiles.
    const statusOps = rollup(order).ops.filter((o) => o.kind === 'status');
    if (statusOps.length) {
      opsBox.append(el('div', { style: { paddingTop: '10px', borderTop: '1px solid var(--line-soft)' } },
        el('div.row', { style: { gap: '10px' } },
          ...statusOps.map((op) => el('span.row', { style: { gap: '6px' } },
            el('span.small.muted', {}, op.label),
            op.status
              ? chip(CUT_STATUS[op.status]?.label || op.status, CUT_STATUS[op.status]?.tone || 'mute')
              : el('span.small', {}, op.text || '—'))))));
    }

    if (!comp.rows.length) {
      opsBox.append(el('div.empty', {}, 'No cutting operations listed for this order.'));
    }
  };
  renderOps();

  const field = (k, v) => el('div', {},
    el('div.small.muted', {}, k),
    el('div', { class: 'strong' }, v ?? '—'));

  const body = el('div', {},
    el('div.grid.three', { style: { marginBottom: '16px' } },
      field('Job #', order.job),
      field('Project', order.project),
      field('Floor / Tag', order.floor),
      field('Qty', fmtNum(order.qty)),
      field('Series', order.series),
      field('Comm / Res', order.commRes),
      field('Cutting date', fmtDate(order.cuttingDate, { withDay: true })),
      field('Glazing date', fmtDate(order.glazingDate, { withDay: true })),
      field('Ship date', fmtDate(order.shipDate, { withDay: true })),
    ),

    order.notes ? el('div.banner.info', { style: { marginBottom: '14px' } },
      el('div', {}, el('strong', {}, 'Note from schedule: '), order.notes)) : null,

    el('div.row', { style: { marginBottom: '14px' } },
      chip(order.purch || 'material unknown', purchTone(order)),
      order.extStatus ? chip(order.extStatus, 'mute') : null,
      order.warehouse ? chip('WH: ' + order.warehouse, 'mute') : null,
      order.reason ? chip(order.reason, 'warn') : null,
    ),

    order.wip ? el('div.row.small.muted', { style: { marginBottom: '14px' } },
      `ERP remaining — assembly ${fmtNum(order.wip.remAssy)}, glazing ${fmtNum(order.wip.remGlaz)}, ship ${fmtNum(order.wip.shpRem)}`) : null,

    el('h4', { style: { margin: '4px 0 8px', fontSize: '13px' } }, 'Cutting operations'),
    opsBox,

    histBox,

    el('div.small.muted', { style: { marginTop: '14px' } },
      `Row ${order.row} of the schedule · id ${order.id}`)
  );

  modal(`W/O ${order.wo}${order.floor ? ' · ' + order.floor : ''}`, body, {
    wide: true,
    actions: [
      {
        label: 'Mark all cut', class: '', onClick: (dlg) => {
          for (const op of rollup(order).ops) {
            if (op.kind === 'qty') setProgress(order.id, op.key, op.target);
          }
          toast(`W/O ${order.wo} marked fully cut by ${me()}`);
          dlg.close();
          rerender?.();
        }
      },
      { label: 'Done', class: 'primary', onClick: (dlg) => dlg.close() },
    ],
  });
}

/* ---------- board ---------- */

export function renderBoard(rerender) {
  const all = activeOrders();
  const projects = Array.from(new Set(all.map((o) => o.project || '—'))).sort();
  const sections = Array.from(new Set(all.map((o) => o.section || '—'))).sort();
  const list = rows();

  const control = (label, key, options) => el('label.field', {},
    el('span', {}, label),
    el('select', {
      value: filters[key],
      onchange: (e) => { filters[key] = e.target.value; rerender(); },
    }, ...options.map((o) => el('option', {
      value: o.value, selected: filters[key] === o.value,
    }, o.label)))
  );

  const head = el('div.panel', {},
    el('div.body', {},
      el('div.grid', { style: { gridTemplateColumns: 'minmax(180px,2fr) repeat(auto-fit,minmax(130px,1fr))', gap: '10px' } },
        el('label.field', {},
          el('span', {}, 'Search'),
          el('input', {
            type: 'search', placeholder: 'W/O, job, project, floor, note…', value: filters.q,
            oninput: (e) => {
              filters.q = e.target.value;
              clearTimeout(head._t);
              head._t = setTimeout(rerender, 180);
            },
          })),
        control('Status', 'risk', [
          { value: 'ALL', label: 'All' },
          ...Object.values(RISK).map((r) => ({ value: r.key, label: r.label })),
        ]),
        control('Project', 'project', [
          { value: 'ALL', label: 'All projects' },
          ...projects.map((p) => ({ value: p, label: p })),
        ]),
        control('Section', 'section', [
          { value: 'ALL', label: 'All sections' },
          ...sections.map((s) => ({ value: s, label: s })),
        ]),
        control('Sort', 'sort', [
          { value: 'urgency', label: 'Urgency' },
          { value: 'cutdate', label: 'Cutting date' },
          { value: 'ship', label: 'Ship date' },
          { value: 'pieces', label: 'Pieces left' },
          { value: 'project', label: 'Project' },
        ]),
      ),
      el('div.row.small.muted', { style: { marginTop: '10px' } },
        `${fmtNum(list.length)} of ${fmtNum(all.length)} orders`,
        el('span.spacer'),
        el('label.row.small', { style: { gap: '6px' } },
          el('input', {
            type: 'checkbox', checked: state.settings.activeOnly, style: { width: 'auto' },
            onchange: (e) => { state.settings.activeOnly = e.target.checked; rerender(); },
          }),
          'Hide historical rows'),
      )
    )
  );

  if (!list.length) {
    return el('div', {}, head, el('div.panel', {},
      el('div.empty', {},
        el('h3', {}, 'Nothing matches those filters'),
        el('div', {}, 'Try clearing the search or switching status back to All.'))));
  }

  const table = el('table', {},
    el('thead', {}, el('tr', {},
      el('th', {}, 'W/O'),
      el('th', {}, 'Project'),
      el('th', {}, 'Floor / Tag'),
      el('th.num', {}, 'Qty'),
      el('th', {}, 'Status'),
      el('th', {}, 'Material'),
      el('th.hide-sm', {}, 'Cut date'),
      el('th.hide-sm', {}, 'Ship'),
      el('th', {}, 'Cut progress'),
    )),
    el('tbody', {}, ...list.map(({ order, risk, roll }) => {
      const tr = el('tr', { style: { cursor: 'pointer' }, onclick: () => openOrder(order, rerender) },
        el('td', {}, el('span.mono.strong', {}, order.wo)),
        el('td', {}, order.project || '—',
          order.job ? el('div.small.muted', {}, 'Job ' + order.job) : null),
        el('td', {}, order.floor || '—'),
        el('td.num', {}, fmtNum(order.qty)),
        el('td', {}, chip(risk.label, risk.tone),
          (() => { const why = reasonFor(order, risk);
            return why ? el('div.small.muted', {}, why) : null; })()),
        el('td', {}, order.purch ? chip(order.purch, purchTone(order)) : el('span.muted', {}, '—')),
        el('td.hide-sm.nowrap', {}, fmtDate(order.cuttingDate)),
        el('td.hide-sm.nowrap', {}, fmtDate(order.shipDate)),
        el('td', {}, roll.target
          ? el('div.row', { style: { gap: '8px', flexWrap: 'nowrap' } },
              bar(roll.pct, roll.complete),
              el('span.mono.small.nowrap', {}, `${fmtNum(roll.done)}/${fmtNum(roll.target)}`))
          : el('span.small.muted', {}, 'no piece counts'))
      );
      return tr;
    }))
  );

  return el('div', {}, head, el('div.panel', {}, el('div.body.flush', {}, el('div.tbl-wrap', {}, table))));
}
