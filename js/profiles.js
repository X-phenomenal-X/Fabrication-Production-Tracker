/* Profile types — how the department thinks about material.

   An order does not arrive as one lump of aluminium: it is widths, heights,
   vents, louvers and so on, and each can be pulled, on order or short
   independently. The Daily Schedule only carries one material status for the
   whole order (`purch`), which is why "the order says Pulled but we are still
   waiting on vents" was invisible. Material status per profile is app-owned. */

export const PROFILES = [
  { key: 'widths',  label: 'Widths',           ops: ['widths'] },
  { key: 'heights', label: 'Heights',          ops: ['hts'] },
  { key: 'vents',   label: 'Vents',            ops: ['vent'] },
  { key: 'louvers', label: 'Louvers',          ops: ['lvrs'] },
  { key: 'service', label: 'Service Orders',   ops: [] },
  { key: 'hinges',  label: 'Hinges',           ops: [] },
  { key: 'extra',   label: 'Extra Operations', ops: ['punch', 'vynls', 'sps', 'wwcnc', 'sldroll', 'sldcut', 'adaptors'] },
];

export const PROFILE_BY_KEY = Object.fromEntries(PROFILES.map((p) => [p.key, p]));

/** Which profile an operation belongs to. */
export const PROFILE_OF_OP = (() => {
  const map = {};
  for (const p of PROFILES) for (const op of p.ops) map[op] = p.key;
  return map;
})();

export function profileForOp(opKey) {
  return PROFILE_OF_OP[opKey] || 'extra';
}

/* Material states a profile can be in. These extend the sheet's vocabulary
   with the ones the shop says out loud but never records. */
export const MATERIAL = {
  PULLED:    { label: 'Pulled',      tone: 'ok',   done: true },
  STOCK_OK:  { label: 'Stock OK',    tone: 'ok',   done: true },
  PARTIAL:   { label: 'Part short',  tone: 'warn', done: false },
  AT_PAINT:  { label: 'At paint',    tone: 'work', done: false },
  ON_ORDER:  { label: 'On order',    tone: 'bad',  done: false },
  EXT_DUE:   { label: 'Extrusion due', tone: 'bad', done: false },
  SHORT:     { label: 'Short',       tone: 'bad',  done: false },
  TBD:       { label: 'TBD',         tone: 'bad',  done: false },
  NA:        { label: 'Not required', tone: 'mute', done: true },
};

export const MATERIAL_ORDER = [
  'PULLED', 'STOCK_OK', 'PARTIAL', 'AT_PAINT', 'ON_ORDER', 'EXT_DUE', 'SHORT', 'TBD', 'NA',
];

/** Seed a profile's material state from the order-level `purch` column, so the
    app starts from what the schedule already says instead of blank. */
export function materialFromPurch(purch) {
  switch (purch) {
    case 'PULLED': return 'PULLED';
    case 'STOCK OK': return 'STOCK_OK';
    case '@ PAINT': return 'AT_PAINT';
    case 'ON ORDER': return 'ON_ORDER';
    case 'EXT DUE': return 'EXT_DUE';
    case 'TBD': return 'TBD';
    case 'NA': return 'NA';
    default: return null;
  }
}
