/* Work centres, taken from the department's own Shift Update, Shift Assignment
   and FOM sheets. The shift update is organised by machine, so the app is too.

   `ops` is the usual operator count on a full shift, from the Shift Assignment
   sheet (week of Aug 12). Edit in Settings if the crewing changes. */

export const MACHINES = [
  { key: 'roll-auto',  label: 'Rolling (Auto)',    group: 'Rolling', ops: 4, note: 'Etas' },
  { key: 'roll-man',   label: 'Rolling (Manual)',  group: 'Rolling', ops: 2, note: 'Iota' },
  { key: 'fom1',       label: 'FOM 1',             group: 'FOM', ops: 1, note: '8900 + Screen' },
  { key: 'fom2',       label: 'FOM 2',             group: 'FOM', ops: 1, note: 'Widths' },
  { key: 'fom3',       label: 'FOM 3',             group: 'FOM', ops: 1, note: 'Vent + Widths' },
  { key: 'cnc1',       label: 'CNC 1',             group: 'CNC', ops: 1 },
  { key: 'cnc2',       label: 'CNC 2',             group: 'CNC', ops: 0 },
  { key: 'cnc3',       label: 'CNC 3',             group: 'CNC', ops: 1 },
  { key: 'cnc140',     label: 'CNC 140',           group: 'CNC', ops: 1 },
  { key: 'multipunch', label: 'Multi Punch',       group: 'Punch', ops: 1, note: 'pcs not frames' },
  { key: 'notching',   label: 'Notching',          group: 'Punch', ops: 0 },
  { key: 'elu1',       label: 'Elumatec Saw #1',   group: 'Saw', ops: 1 },
  { key: 'elu2',       label: 'Elumatec Saw #2',   group: 'Saw', ops: 2 },
  { key: 'saw1',       label: 'Saw #1',            group: 'Saw', ops: 0 },
  { key: 'saw3',       label: 'Saw #3',            group: 'Saw', ops: 0 },
  { key: 'saw4',       label: 'Saw #4',            group: 'Saw', ops: 0 },
  { key: 'saw5',       label: 'Saw #5',            group: 'Saw', ops: 0 },
  { key: 'proline',    label: 'Proline',           group: 'Saw', ops: 0 },
];

/* Standing rows on the shift update that are not machines but always get
   reported on. They appear at the top of the update, as in the sheet. */
export const STANDING_ROWS = [
  { key: 'service',  label: 'Service Orders' },
  { key: 'k1285',    label: 'K1285 Pulls' },
  { key: 'backorder', label: 'Back Order' },
];

export const MACHINE_BY_KEY = Object.fromEntries(
  [...MACHINES, ...STANDING_ROWS].map((m) => [m.key, m]));

export const SHIFT_ROWS = [...STANDING_ROWS, ...MACHINES];

/* Product routing, from the TARGETS sheet. Which work centres a product type
   passes through — used to suggest where an order should go. */
export const ROUTING = {
  'Window wall': ['roll-auto', 'saw1', 'fom2', 'multipunch', 'cnc1'],
  'Vents': ['roll-auto', 'fom3'],
  'Doors': ['roll-auto', 'fom1', 'cnc1'],
};

/* Weekly targets per work centre, from the TARGETS sheet.
   `perShift` is the rate the department plans against. */
export const TARGETS = {
  'roll-auto': { perWeek: 3031, perShift: 216.5, shifts: 14 },
  'roll-man': { perWeek: 0, perShift: 0, shifts: 10 },
  'fom1': { perWeek: 0, perShift: 0, shifts: 12 },
  'fom2': { perWeek: 0, perShift: 0, shifts: 18 },
  'fom3': { perWeek: 0, perShift: 0, shifts: 18 },
  'multipunch': { perWeek: 0, perShift: 0, shifts: 10 },
  'cnc1': { perWeek: 0, perShift: 0, shifts: 13 },
};

export function machinesByGroup() {
  const groups = new Map();
  for (const m of MACHINES) {
    if (!groups.has(m.group)) groups.set(m.group, []);
    groups.get(m.group).push(m);
  }
  return groups;
}
