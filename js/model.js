/* Derived views over the imported schedule. This is where "1621 spreadsheet
   rows" becomes "what does Cutting need to do today". */

import { state } from './store.js';
import { OPS, QTY_OPS, OP_BY_KEY, CUT_STATUS, PURCH_TONE } from './schema.js';

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  if (!a || !b) return null;
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

export function progressFor(orderId, opKey) {
  const p = state.progress[`${orderId}|${opKey}`];
  if (!p || p.deleted) return null;
  return p;
}

/** Per-order cutting rollup: pieces done vs pieces required. */
export function rollup(order) {
  let target = 0;
  let done = 0;
  const ops = [];
  for (const op of OPS) {
    const src = order.ops?.[op.key];
    if (!src) continue;
    if (op.kind === 'qty') {
      const p = progressFor(order.id, op.key);
      const d = Math.min(p?.done ?? 0, src.target);
      target += src.target;
      done += d;
      ops.push({ ...op, target: src.target, done: d, by: p?.by, at: p?.at, complete: d >= src.target });
    } else {
      ops.push({ ...op, status: src.status, text: src.text });
    }
  }
  return {
    ops,
    target,
    done,
    remaining: Math.max(0, target - done),
    pct: target ? Math.round((done / target) * 100) : null,
    complete: target > 0 && done >= target,
    started: done > 0,
  };
}

/** Is this order part of live work, or historical backlog?
    The sheet keeps finished work below the active schedule, and the section
    bands are not reliable for this, so it is decided on dates and status. */
export function isActive(order, ref = today()) {
  const cut = order.ops?.cut?.status;
  if (cut === 'OK' || cut === 'DONE') {
    // Finished cutting still counts as active until it ships.
    if (order.shipDate && order.shipDate < addDays(ref, -7)) return false;
  }
  const horizonPast = addDays(ref, -21);
  const dates = [order.cuttingDate, order.shipDate, order.glazingDate].filter(Boolean);
  if (!dates.length) return cut !== 'OK' && cut !== 'DONE';
  return dates.some((d) => d >= horizonPast);
}

export function activeOrders() {
  return state.settings.activeOnly ? state.orders.filter((o) => isActive(o)) : state.orders;
}

export const RISK = {
  BLOCKED: { key: 'BLOCKED', label: 'Blocked', tone: 'bad', rank: 0 },
  LATE: { key: 'LATE', label: 'Past cut date', tone: 'bad', rank: 1 },
  DUE: { key: 'DUE', label: 'Due this week', tone: 'warn', rank: 2 },
  SOON: { key: 'SOON', label: 'Upcoming', tone: 'mute', rank: 3 },
  DONE: { key: 'DONE', label: 'Cut complete', tone: 'ok', rank: 4 },
};

/** Why an order needs attention — the single most important thing about it. */
export function riskOf(order, ref = today()) {
  const r = rollup(order);
  const cut = order.ops?.cut?.status;

  if (r.complete || cut === 'OK' || cut === 'DONE') return RISK.DONE;

  // Material that has not arrived is the one thing cutting cannot work around.
  const blockedMaterial = ['ON ORDER', 'EXT DUE', 'TBD'].includes(order.purch);
  if (cut === 'BO' || cut === 'NR' || blockedMaterial) return RISK.BLOCKED;

  if (order.cuttingDate && order.cuttingDate < ref) return RISK.LATE;
  if (order.cuttingDate && order.cuttingDate <= addDays(ref, 7)) return RISK.DUE;
  return RISK.SOON;
}

/** The specific cause behind a risk, so the board never shows "Blocked" next to
    a green material chip without explaining itself. */
export function reasonFor(order, risk = riskOf(order), ref = today()) {
  if (risk === RISK.BLOCKED) {
    const cut = order.ops?.cut?.status;
    if (cut === 'BO') return 'Back order';
    if (cut === 'NR') return 'Material not received';
    if (order.purch === 'ON ORDER') return 'Material on order';
    if (order.purch === 'EXT DUE') return 'Extrusion due in';
    if (order.purch === 'TBD') return 'Material TBD';
    return 'Blocked';
  }
  if (risk === RISK.LATE) {
    const d = daysBetween(order.cuttingDate, ref);
    return d ? `${d} day${d === 1 ? '' : 's'} past cut date` : 'Past cut date';
  }
  if (risk === RISK.DUE) {
    const d = daysBetween(ref, order.cuttingDate);
    return d === 0 ? 'Cut today' : `Cut in ${d} day${d === 1 ? '' : 's'}`;
  }
  return null;
}

export function cutTone(order) {
  const s = order.ops?.cut?.status;
  return s && CUT_STATUS[s] ? CUT_STATUS[s].tone : 'mute';
}

export function purchTone(order) {
  return PURCH_TONE[order.purch] || 'mute';
}

/** The cutting queue: what to work on, most urgent first. */
export function queue({ ref = today(), limit = null } = {}) {
  const rows = activeOrders()
    .map((o) => ({ order: o, risk: riskOf(o, ref), roll: rollup(o) }))
    .filter((x) => x.risk !== RISK.DONE)
    .sort((a, b) => {
      if (a.risk.rank !== b.risk.rank) return a.risk.rank - b.risk.rank;
      const ad = a.order.cuttingDate || a.order.shipDate || '9999';
      const bd = b.order.cuttingDate || b.order.shipDate || '9999';
      if (ad !== bd) return ad < bd ? -1 : 1;
      return b.roll.remaining - a.roll.remaining;
    });
  return limit ? rows.slice(0, limit) : rows;
}

export function planFor(date, shift) {
  return state.plan[`${date}|${shift}`]?.ids || [];
}

export function orderById(id) {
  return state.orders.find((o) => o.id === id) || null;
}

/** Totals for the header strip. */
export function summary(ref = today()) {
  const rows = activeOrders();
  let blocked = 0, late = 0, due = 0, done = 0, pieces = 0, piecesDone = 0;
  for (const o of rows) {
    const r = riskOf(o, ref);
    if (r === RISK.BLOCKED) blocked++;
    else if (r === RISK.LATE) late++;
    else if (r === RISK.DUE) due++;
    else if (r === RISK.DONE) done++;
    const roll = rollup(o);
    pieces += roll.target;
    piecesDone += roll.done;
  }
  return {
    total: rows.length, blocked, late, due, done,
    pieces, piecesDone,
    pct: pieces ? Math.round((piecesDone / pieces) * 100) : 0,
  };
}

/** Work logged during a shift, reconstructed from progress timestamps. */
export function workInWindow(fromIso, toIso) {
  const out = [];
  for (const [key, p] of Object.entries(state.progress)) {
    if (!p || p.deleted || !p.at) continue;
    if (p.at < fromIso || p.at > toIso) continue;
    const [orderId, opKey] = key.split('|');
    const order = orderById(orderId);
    if (!order) continue;
    out.push({ order, op: OP_BY_KEY[opKey], done: p.done, by: p.by, at: p.at });
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : -1));
}

export function shiftWindow(date, shift) {
  // Midnight runs 23:00 -> 07:00 and therefore crosses into the next day.
  const mk = (d, h) => `${d}T${String(h).padStart(2, '0')}:00:00.000Z`;
  if (shift === 'DAY') return [mk(date, 7), mk(date, 15)];
  if (shift === 'AFT') return [mk(date, 15), mk(date, 23)];
  return [mk(date, 23), mk(addDays(date, 1), 7)];
}

export const ALL_OPS = OPS;
export const QTY_OP_LIST = QTY_OPS;
