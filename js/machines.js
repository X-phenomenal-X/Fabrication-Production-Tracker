/* Work centres, taken from the department's own Shift Update and Shift
   Assignment sheets. The shift update is organised by machine, so the app is.

   `ops` is the usual operator count on a full shift, from the Shift Assignment
   sheet (week of Aug 12). Edit in Setup if the crewing changes. */

export const MACHINES = [
  { key: 'roll-auto',  label: 'Rolling (Auto)',    group: 'Rolling', ops: 4, note: 'Etas' },
  { key: 'roll-man',   label: 'Rolling (Manual)',  group: 'Rolling', ops: 2, note: 'Iota' },
  { key: 'fom1',       label: 'FOM 1',             group: 'FOM', ops: 1, note: '8900 + Screen' },
  { key: 'fom2',       label: 'FOM 2',             group: 'FOM', ops: 1, note: 'Widths' },
  { key: 'fom3',       label: 'FOM 3',             group: 'FOM', ops: 1, note: 'Vent + Widths' },

  /* CNC & FMC. The workbook's `CNC & FMC` sheet is one flat list with no
     machine column — there is no per-machine CNC schedule anywhere in it — so
     everything it imports lands in this shared queue and is put on a machine
     by hand. `queue: true` marks it as the holding pen rather than a machine
     anyone stands at, so it is skipped on the shift update and in targets. */
  { key: 'cncfmc',     label: 'Unassigned',        group: 'CNC', queue: true,
    note: 'straight off the CNC & FMC sheet' },
  /* One machine, two names: the shift-update sheet writes it as CNC-3 while
     the floor calls it CNC 1. Both are mapped to this key in SU_MACHINE, so
     its schedule and its shift-update entry land together. */
  { key: 'cnc1',       label: 'CNC 1',             group: 'CNC', ops: 1,
    note: 'CNC-3 on the shift update' },
  { key: 'fmc1',       label: 'FMC 1',             group: 'CNC', ops: 1 },
  { key: 'fmc2',       label: 'FMC 2',             group: 'CNC', ops: 1 },

  { key: 'multipunch', label: 'Multi Punch',       group: 'Punch', ops: 1, note: 'pcs not frames' },
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

/** Machines a line can actually be put on, per group. The shared queue is not
    one of them — assigning a line to it is the same as leaving it unassigned. */
export function assignableIn(group) {
  return MACHINES.filter((m) => m.group === group && !m.queue);
}

/** Whether this centre imports into a shared queue. Only CNC & FMC does — its
    sheet has no machine column at all, so every line there starts unassigned.
    Used for wording, not for permission: see `canMoveIn`. */
export function hasQueue(group) {
  return MACHINES.some((m) => m.group === group && m.queue);
}

/** Whether lines in this centre can be moved between machines. Anywhere with
    more than one machine to choose from: the FOM sheets say which FOM a job is
    on and the Rolling sheets say Auto or Manual, but the floor moves work
    between them during a shift, and the tracker has to be able to follow. */
export function canMoveIn(group) {
  return assignableIn(group).length > 1;
}

export function machinesByGroup() {
  const groups = new Map();
  for (const m of MACHINES) {
    if (!groups.has(m.group)) groups.set(m.group, []);
    groups.get(m.group).push(m);
  }
  return groups;
}
