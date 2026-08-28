/* Work centres, taken from the department's own Shift Update and Shift
   Assignment sheets. The shift update is organised by machine, so the app is.

   `short` is for the places a station is a column rather than a heading — the
   job grid, mainly. Written out rather than derived, because initials collide
   where it matters most: FOM 1 and FMC 1 both come out "F1", and those two are
   on the same job often enough that a guess would be read as a fact.

   `ops` is the usual operator count on a full shift, from the Shift Assignment
   sheet (week of Aug 12). Edit in Setup if the crewing changes. */

export const MACHINES = [
  { key: 'roll-auto',  label: 'Rolling (Auto)', short: 'R-A',    group: 'Rolling', ops: 4, note: 'Etas' },
  { key: 'roll-man',   label: 'Rolling (Manual)', short: 'R-M',  group: 'Rolling', ops: 2, note: 'Iota' },
  { key: 'fom1',       label: 'FOM 1', short: 'FOM1',             group: 'FOM', ops: 1, note: '8900 + Screen' },
  { key: 'fom2',       label: 'FOM 2', short: 'FOM2',             group: 'FOM', ops: 1, note: 'Widths' },
  { key: 'fom3',       label: 'FOM 3', short: 'FOM3',             group: 'FOM', ops: 1, note: 'Vent + Widths' },

  /* CNC & FMC. The workbook's `CNC & FMC` sheet is one flat list with no
     machine column — there is no per-machine CNC schedule anywhere in it — so
     everything it imports lands in this shared queue and is put on a machine
     by hand. `queue: true` marks it as the holding pen rather than a machine
     anyone stands at, so it is skipped on the shift update and in targets. */
  { key: 'cncfmc',     label: 'Unassigned', short: 'QUE',        group: 'CNC', queue: true,
    note: 'straight off the CNC & FMC sheet' },
  /* One machine, two names: the shift-update sheet writes it as CNC-3 while
     the floor calls it CNC 1. Both are mapped to this key in SU_MACHINE, so
     its schedule and its shift-update entry land together. */
  { key: 'cnc1',       label: 'CNC 1', short: 'CNC1',             group: 'CNC', ops: 1,
    note: 'CNC-3 on the shift update' },
  { key: 'fmc1',       label: 'FMC 1', short: 'FMC1',             group: 'CNC', ops: 1 },
  { key: 'fmc2',       label: 'FMC 2', short: 'FMC2',             group: 'CNC', ops: 1 },

  /* The sheet imports into Multi Punch, so that stays the centre's first
     machine and what the tab opens on.

     Heights come off rolling to the Elumatec saw, and the same heights then go
     to the punch. The workbook's `MultiPunch & SAW` sheet has a SAW column but
     it is empty — the saw is run off the floor's own knowledge, not off the
     file — so its lines are put on it by hand, and the learned routing picks up
     which components go there once it has seen a couple. */
  { key: 'multipunch', label: 'Multi Punch', short: 'PUN',       group: 'Punch', ops: 1, note: 'pcs not frames' },
  { key: 'saw',        label: 'Elumatec Saw', short: 'SAW',      group: 'Punch', ops: 1, note: 'heights' },
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
