/* The shape of the Daily Schedule, and the vocabulary the shop actually uses.
   Column numbers are 1-based to match Excel, so they can be checked by eye
   against the sheet. */

export const SHEET = {
  DAILY: 'Daily Sched',
  WIP: 'WIP',
  PREP: 'PREP Tracker',
  SCREENS: 'screens sch',
};

/* Columns 1-26: the order and its schedule. */
export const FIELDS = {
  wo: 1,
  job: 2,
  project: 3,
  floor: 4,
  qty: 5,
  notes: 6,
  rem: 7,
  quar: 8,
  commRes: 9,
  vents: 10,
  drFramesCutting: 11,
  series: 12,
  shipDate: 13,
  glazingDate: 15,
  cuttingDate: 16,
  panelsToGlazing: 17,
  purch: 18,
  bdRec: 19,
  weeks: 20,
  extStatus: 21,
  warehouse: 22,
  reason: 23,
  openReq: 24,
  openReqQty: 25,
  daysToShip: 26,
};

/* Columns 27-41: the Cutting department's own work.
   kind:'status' holds a word; kind:'qty' holds a piece count that the crew
   works down over a shift. */
export const OPS = [
  { key: 'cut', col: 27, label: 'CUT', kind: 'status', note: 'Overall cut status' },
  { key: 'hts', col: 28, label: 'HTS', kind: 'qty', alt: 'VERT. CUT' },
  { key: 'widths', col: 29, label: 'WIDTHS', kind: 'qty', alt: 'VERT. CNC' },
  { key: 'punch', col: 30, label: 'PUNCH', kind: 'qty', alt: 'WIDTHS' },
  { key: 'vynls', col: 31, label: 'VYNL.S', kind: 'qty' },
  { key: 'sps', col: 32, label: 'SP.S', kind: 'qty' },
  // Louvres belong to Cutting, so this column stays despite the "PAN" in its name.
  { key: 'lvrs', col: 33, label: 'LVRS/TC PAN', kind: 'qty' },
  { key: 'vent', col: 34, label: 'VENT', kind: 'qty' },
  { key: 'wwcnc', col: 35, label: 'WW CNC', kind: 'qty' },
  // Column 36, CP CUTTING (sub-header "C CHANNEL (PANEL)"), is panel work and
  // belongs to another department. Deliberately not tracked here.
  { key: 'sldroll', col: 37, label: 'SLD ROLLING', kind: 'qty' },
  { key: 'sldcut', col: 38, label: 'SLD CUTTING', kind: 'qty' },
  { key: 'adaptors', col: 39, label: 'ADAPTORS CNC', kind: 'qty' },
  { key: 'bdprep', col: 40, label: 'BD Prep', kind: 'status' },
  { key: 'mtlstatus', col: 41, label: 'MTL STATUS', kind: 'status' },
];

export const QTY_OPS = OPS.filter((o) => o.kind === 'qty');
export const OP_BY_KEY = Object.fromEntries(OPS.map((o) => [o.key, o]));

/* Cut status vocabulary, with the spelling variants seen in the sheet folded in.
   `rank` orders the board so trouble floats to the top. */
export const CUT_STATUS = {
  BO: { label: 'Back Order', tone: 'bad', rank: 0 },
  NR: { label: 'Not Received', tone: 'bad', rank: 1 },
  IP: { label: 'In Progress', tone: 'work', rank: 2 },
  ROLLING: { label: 'Rolling', tone: 'work', rank: 3 },
  ROLLED: { label: 'Rolled', tone: 'ok', rank: 4 },
  OK: { label: 'Cut OK', tone: 'ok', rank: 5 },
  DONE: { label: 'Done', tone: 'ok', rank: 6 },
  NA: { label: 'N/A', tone: 'mute', rank: 7 },
};

const CUT_ALIASES = {
  'I.P': 'IP', 'I/P': 'IP', 'IN PROGRESS': 'IP', 'INPROGRESS': 'IP',
  'N/A': 'NA', 'NA': 'NA', '-': 'NA',
  'B/O': 'BO', 'BACK ORDER': 'BO', 'BACKORDER': 'BO',
  'N.R': 'NR', 'NOT RECEIVED': 'NR',
  'OK': 'OK', 'DONE': 'DONE', 'ROLLING': 'ROLLING', 'ROLLED': 'ROLLED',
  'COMPLETE': 'DONE', 'COMPLETED': 'DONE',
};

export function normCutStatus(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toUpperCase().replace(/\s+/g, ' ');
  if (!s) return null;
  if (CUT_ALIASES[s]) return CUT_ALIASES[s];
  if (CUT_STATUS[s]) return s;
  return null; // unrecognised: kept as free text on the order instead
}

/* Material / purchasing vocabulary. These drive the "can we even cut it?" answer. */
const PURCH_ALIASES = {
  'PULLED': 'PULLED', 'STOCK OK': 'STOCK OK', '@ PAINT': '@ PAINT', 'AT PAINT': '@ PAINT',
  'ON ORDER': 'ON ORDER', 'EXT DUE': 'EXT DUE', 'TBD': 'TBD', 'N/A': 'NA',
};

export function normPurch(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toUpperCase().replace(/\s+/g, ' ');
  if (!s) return null;
  return PURCH_ALIASES[s] || s;
}

export const PURCH_TONE = {
  'PULLED': 'ok', 'STOCK OK': 'ok', '@ PAINT': 'work',
  'ON ORDER': 'bad', 'EXT DUE': 'bad', 'TBD': 'bad', 'NA': 'mute',
};

/* Section bands that appear as lone text rows in the sheet.
   Deliberately excludes PREP, TRIMS and B/S: those look like banners but are
   real order rows in this workbook (e.g. row 277 "TRIMS" has 34 populated
   cells), and treating them as bands silently reassigns hundreds of orders. */
export const SECTION_HINTS = [
  'COMMERCIAL DOOR FRAMES', 'MU FOR DESIGN/TESTING', 'IN GLAZING', 'IN CUTTING',
  "MAT'L REQUIRED", 'GLASS ONLY JOBS', 'SHIPPING SCHEDULE', 'WINDOW WALL',
  'ON HOLD', 'SCHEDULING IN PROCESS',
];

/* A banner never carries order data, so it stays sparse. Real orders in this
   sheet populate at least this many cells. */
export const BANNER_MAX_FILLED = 5;

/* Rows whose first cell is one of these are layout noise: repeated header rows,
   separators, and the scheduler warning that appears mid-sheet. */
const JUNK_FIRST_CELL = new Set([
  'W/O#', 'W/O #', 'WO#', '-', '--', '', 'QUEST',
  'PLEASE SEE SCHEDULER BEFORE PROCEEDING BELOW:',
  'PLEASE SEE SCHEDULER BEFORE PROCEEDING BELOW',
]);

export function isJunkRow(first) {
  if (first == null) return true;
  const s = String(first).trim().toUpperCase();
  return JUNK_FIRST_CELL.has(s);
}

/** Work order ids are not all numeric: mock-ups (MU2026-012), sample orders
    (DAN 509), glass-only orders (29038so) and named rows (TRIMS, gly hoist)
    are all legitimate. Anything not explicitly junk counts as an id. */
export function isWorkOrder(v) {
  if (v == null) return false;
  if (typeof v === 'object' && v.error) return false;
  const s = String(v).trim();
  if (!s) return false;
  return !isJunkRow(s);
}

/** Numeric ERP work orders sort and match against the WIP export; the rest don't. */
export function isErpWorkOrder(v) {
  return v != null && /^\d{3,7}$/.test(String(v).trim());
}

/** Panel work belongs to another department. A row counts as panel-only when it
    is labelled as panels AND carries no cutting piece counts — so an ordinary
    order that merely mentions panels is never dropped. */
export function isPanelOnly(project, floor, hasCuttingWork) {
  if (hasCuttingWork) return false;
  const text = `${project || ''} ${floor || ''}`;
  return /\bpanels?\b/i.test(text);
}

export const SHIFTS = {
  DAY: { key: 'DAY', label: 'Day', short: 'D', from: 7, to: 15, full: true },
  AFT: { key: 'AFT', label: 'Afternoon', short: 'A', from: 15, to: 23, full: true },
  NIGHT: { key: 'NIGHT', label: 'Midnight', short: 'M', from: 23, to: 7, full: false, crew: 3 },
};
export const SHIFT_ORDER = ['DAY', 'AFT', 'NIGHT'];

/** Which shift covers a given time — used to preselect the shift on the log. */
export function shiftAt(date = new Date()) {
  const h = date.getHours();
  if (h >= 7 && h < 15) return 'DAY';
  if (h >= 15 && h < 23) return 'AFT';
  return 'NIGHT';
}
