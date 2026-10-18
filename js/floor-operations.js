/* V2.2 metadata stays on the existing versioned records: no second datastore. */
import { state, setTodo, saveShiftLog, me } from './store.js';

export const LOSS_REASONS = ['Equipment', 'Material', 'Setup', 'Staffing', 'Other'];
export const MAINTENANCE_STATES = ['Not notified', 'Notified', 'In progress', 'Waiting on parts', 'Repaired'];
export const QUALITY_STATES = ['Open', 'Contained', 'Under review', 'Disposition complete'];

// Shift-local plans never derive window counts from imported piece quantities.
export function machineTarget(machine, input) {
  const number = (key, label, { optional = false, whole = false } = {}) => {
    const raw = input[key];
    if (raw == null || String(raw).trim() === '') {
      if (optional) return null;
      throw new Error(`Enter ${label}.`);
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 1000000 || (whole && !Number.isInteger(n)))
      throw new Error(`Use a valid non-negative ${whole ? 'whole ' : ''}number for ${label}.`);
    return n;
  };
  const rate = number('rate', 'hourly standard');
  const available = number('available', 'available minutes');
  const setup = number('setup', 'planned setup minutes');
  const bandsaw = machine === 'saw' ? number('bandsaw', 'planned bandsaw minutes') : 0;
  const actual = number('actual', 'good output', { optional: true, whole: true });
  if (rate <= 0) throw new Error('Hourly standard must be greater than zero.');
  if (available > 1440 || setup + bandsaw > available) throw new Error('Time allowances must fit within available minutes (maximum 1440).');
  const productive = available - setup - bandsaw;
  const target = Math.floor(rate * productive / 60);
  if (!Number.isSafeInteger(target)) throw new Error('Target is too large.');
  return { version: 1, unit: machine === 'multipunch' ? 'windows' : 'pieces', rate, available, setup, bandsaw, productive, target, actual };
}

export function machineTargetText(plan) {
  if (!plan) return '';
  const attainment = plan.actual != null && plan.target > 0
    ? ` · ${Math.round(plan.actual / plan.target * 100)}% of plan` : '';
  return `Target ${plan.target} ${plan.unit} · Good output ${plan.actual == null ? 'not recorded' : plan.actual + ' ' + plan.unit}${attainment}. `
    + `Standard ${plan.rate}/h × ${plan.productive} production min ÷ 60 (rounded down). `
    + `Available after breaks ${plan.available} min; planned setup ${plan.setup} min; planned bandsaw ${plan.bandsaw} min. Actual downtime does not reduce this plan.`;
}
export function validCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === value;
}

// A stopped timer is not proof that production has resumed. Keep the report
// visible for verification, without presenting it as a currently running loss.
export function downtimeNeedsVerification(item) {
  const op = item.operation;
  return !item.done && op?.kind === 'downtime' && !op.timer?.startedAt
    && (!!op.timer || op.maintenance === 'Repaired');
}
export function elapsedMinutes(op, now = new Date()) {
  const timer = op?.timer;
  if (!timer) return op?.minutes ?? null;
  const intervals = [...(timer.intervals || []), ...(timer.startedAt ? [[timer.startedAt, now.toISOString()]] : [])];
  return Math.round(intervals.reduce((total, [start, end]) => total + Math.max(0, Date.parse(end) - Date.parse(start)), 0) / 60000);
}
export function lossMinutesOn(item, date, now = new Date()) {
  if (!item.operation?.timer) return item.date === date ? Number(item.operation?.minutes) || 0 : 0;
  const from = new Date(date + 'T00:00:00');
  const until = new Date(from); until.setDate(until.getDate() + 1);
  const timer = item.operation.timer;
  const intervals = [...(timer.intervals || []), ...(timer.startedAt ? [[timer.startedAt, now.toISOString()]] : [])];
  return intervals.reduce((total, [start, end]) => total + Math.max(0, Math.min(+until, Date.parse(end), +now) - Math.max(+from, Date.parse(start))), 0) / 60000;
}
export function toggleDowntime(id, now = new Date()) {
  const item = state.todos[id];
  if (!item || item.done || item.operation?.kind !== 'downtime') throw new Error('Choose an open downtime report.');
  const op = item.operation;
  if (!op.timer && op.minutes != null) throw new Error('This report already has manual minutes. Create a separate timed event.');
  const timer = structuredClone(op.timer || { intervals: [], startedAt: null });
  if (timer.startedAt) {
    if (+now < Date.parse(timer.startedAt)) throw new Error('Device time is earlier than the timer start.');
    timer.intervals.push([timer.startedAt, now.toISOString()]); timer.startedAt = null;
  } else {
    if (Object.values(state.todos).some(t => t.id !== id && !t.done && t.operation?.machine === op.machine && t.operation?.timer?.startedAt)) {
      throw new Error('A timer is already running for this machine. Stop it first.');
    }
    timer.startedAt = now.toISOString();
  }
  setTodo(id, { operation: { ...op, timer, minutes: elapsedMinutes({ timer }, now) } });
}
export function handoverSignature(log) {
  return JSON.stringify({ rows: log.rows || {}, notes: log.notes || '', carryover: log.carryover || [] });
}
export function handoverAcknowledged(log) {
  return !!log?.acknowledgement && log.acknowledgement.signature === handoverSignature(log);
}
export function acknowledgeHandover(date, shift) {
  const log = state.shiftLogs[`${date}|${shift}`];
  if (!log) throw new Error('Save the handover first.');
  if (!me() || me() === 'Unassigned') throw new Error('Select your app user before acknowledging.');
  saveShiftLog(date, shift, { acknowledgement: { by: me(), at: new Date().toISOString(), signature: handoverSignature(log) } });
}
export function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function reportCsv(rows) { return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n'); }

// Small JPEG attachments travel through the existing backup/sync path. Bounded
// size protects localStorage and avoids embedding full camera originals.
export async function prepareEvidence(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error('Choose a JPEG, PNG or WebP photo under 10 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    const scale = Math.min(1, 1000 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/jpeg', 0.6);
    if (data.length > 160000) throw new Error('Photo is too detailed. Crop it closer and try again.');
    return { name: file.name.slice(0, 100), data };
  } finally { URL.revokeObjectURL(url); }
}
