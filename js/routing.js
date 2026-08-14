/* Where a job goes next, and what paperwork has to travel with it.

   From SOP-WW-CUT-008 v8.0 (Window Wall & Vents Material Flow, effective
   August 2026). Until now the app learned routing by watching what people did
   — useful for the CNC sheet, which says nothing at all — but the department
   has a written standard for window wall and vents, and a written rule beats a
   habit. So the rules are encoded here and outrank the learned ones.

   Two tracks that never mix:

     WINDOW WALL   raw stock -> Auto Rolling -> splits widths / heights
     VENTS         separate entity -> Manual Rolling -> FOM 3 -> vent assembly

   The half of the SOP that is not routing at all is the paperwork: which
   document set a station needs and, when it is not already at the machine,
   whose office to get it from. That is carried on each step, because "it goes
   to the saw" is not the useful answer if the cutsheets are still in Firas's
   office. */

import { dieForms, lookupDie } from './dies.js';

export const SOP = {
  id: 'SOP-WW-CUT-008',
  version: '8.0',
  title: 'Window Wall & Vents Material Flow',
  effective: 'August 2026',
};

/* The five dies that go the long way round. Everything else on the widths
   line skips the saw and the widths punch entirely and goes straight to
   FOM 2 — which is the rule most worth getting right, because it is the one
   that sends material to two extra stations it does not need. */
export const SAW_WIDTH_DIES = ['SA80-104', 'SA80-105', 'SA80-255', 'SA80-256', 'SA80-261'];
const SAW_SET = new Set(SAW_WIDTH_DIES);

/* Dies that put a height on an FMC after the punch, alongside pin holes and
   ISV. Written SA80.236/235 on the flowchart, which is schedule spelling. */
const FMC_DIES = new Set(['SA80-235', 'SA80-236']);

/* Each step as the SOP states it: the station, the document set that has to be
   with it, where that set lives when it is not at the machine, and who owns
   it. `machine` is the app's own key where the step is a machine the app
   tracks; assembly is real but not scheduled here, so it has none. */
const STEP = {
  rollAuto: {
    machine: 'roll-auto', station: 'Auto Rolling',
    paper: 'Rolling sheets only', where: 'Floor staging / job traveller', who: 'Material handler',
  },
  rollManual: {
    machine: 'roll-man', station: 'Manual Rolling',
    paper: 'Rolling sheets only', where: 'Vent staging rack / job traveller', who: 'Material coordinator',
  },
  fom2: {
    machine: 'fom2', station: 'FOM 2',
    paper: 'FOM width report', where: 'FOM workstation console', who: 'CNC programmer',
  },
  sawWidths: {
    machine: 'saw', station: 'Elumatec Saw (widths)',
    paper: 'Manual cutsheets + barcode labels', where: 'Station staging rack', who: 'Saw operator / CAD team',
  },
  /* The SOP draws Widths Punch and Multi Punch as two boxes with their own
     paperwork; the department's schedules only ever name one punch, so the app
     has only one machine. Left unmapped rather than pointed at Multi Punch:
     showing the station on the route is right either way, but assigning a
     widths line to the heights punch would not be. */
  widthsPunch: {
    machine: null, station: 'Widths Punch',
    paper: 'Punch sheet', where: 'Widths punch workstation', who: 'Punch operator',
  },
  sawHeights: {
    machine: 'saw', station: 'Elumatec Saw (heights)',
    paper: 'Heights cutsheets (set 2 of 2)', where: "Firas's office, if not already at the saw", who: 'Firas / scheduling',
  },
  multiPunch: {
    machine: 'multipunch', station: 'Multi Punch',
    paper: 'Breakdown package (window info) + labels', where: 'Aisle 2 of the office', who: 'Dimble / Smit',
  },
  /* "FMC-1 / FMC-2" — the SOP says a height with pin holes needs an FMC, not
     which one. That second half is a capacity call, and the learned routing
     already answers it from what the floor actually does, so this step names
     no machine and leaves the choice where it belongs. */
  fmc: {
    machine: null, station: 'FMC 1 / FMC 2',
    paper: 'Program paper', where: 'Aisle 2 of the office', who: 'Neel (programmer)',
  },
  fom3: {
    machine: 'fom3', station: 'FOM 3',
    paper: 'Vent cutsheet (set 2 of 2)', where: 'FOM 3 station workstation', who: 'CAD / scheduling team',
  },
  assembly: {
    machine: null, station: 'Main assembly / prep (station 4)',
    paper: null, where: 'Window wall frames', who: 'Assembly',
  },
  ventAssembly: {
    machine: null, station: 'Vent assembly',
    paper: 'Master vent kit traveller', where: 'Vent line cart rack', who: 'Vent assembly team',
  },
};

/** Is this a high thermal die? The section book suffixes them HT and HTX, and
    the SOP's first branch turns on exactly that. */
export function isHighThermal(die) {
  const { sa } = dieForms(die);
  return !!sa && /(HT|HTX)$/.test(sa);
}

/** One of the five the SOP sends through the saw and the widths punch. The
    high thermal versions of the same numbers are not — S80.104 goes that way,
    S80.104HT does not — so this is only ever asked after the HT branch. */
export function isSawWidthDie(die) {
  const { sa } = dieForms(die);
  return !!sa && SAW_SET.has(sa);
}

/** The die's series — '80' for window wall, '85' for the vent line. Null where
    the number is not a die at all, which the schedules do carry: "Door sash",
    "Mock UP", "RUSH order". */
function seriesOf(die) {
  const { sa } = dieForms(die);
  return sa ? sa.slice(2, 4) : null;
}

/* Which way a member runs, from the section book's own description — a
   vertical is a height and goes to the saw, a horizontal is a width. Only
   about half the descriptions say, and sills and TOS frames say neither, so
   this returns null far more often than not and is never treated as a rule. */
export function orientationOf(die) {
  const desc = lookupDie(die).assembly?.desc || '';
  if (/vert/i.test(desc)) return 'height';
  if (/horiz/i.test(desc)) return 'width';
  return null;
}

/* Whether a line is window wall or vents, and if window wall, whether it is a
   width or a height. The schedules carry no column for any of this, so it is
   read off the machine the workbook already has the line on, which is the same
   split the SOP describes: vents roll manual and cut on FOM 3, widths cut on
   FOM 2, heights go to the saw and the punch.

   Stated as a guess with its reason rather than as fact, because it is one:
   Manual Rolling also runs sliding door, flashing and door sash, and FOM 3 is
   a vent-and-widths machine. The reason travels to the screen so the person
   reading it can see what the app went on. */
function classify(task) {
  const m = task.machine;
  const series = seriesOf(task.die);

  /* This SOP is window wall and vents, and nothing else. The department also
     runs sliding door, flashing and door sash through the same rolling
     machines, and FOM 1 is the 8900-and-screen machine — none of that is on
     this flowchart, and inventing a route for it would be worse than saying
     so. Window wall is the 8000 series; the vent line is the 8500s. */
  if (m === 'fom1') return { track: null };
  if (series && series !== '80' && series !== '85') return { track: null };

  if (m === 'fom3') {
    return { track: 'vents', at: 'fom3', sure: true, why: 'on FOM 3, the vent cut line' };
  }
  if (m === 'roll-man') {
    // Manual rolling is where vent stock starts, but it also runs door sash
    // and flashing, so the series has to agree before this is called a vent.
    if (series === '85') {
      return { track: 'vents', at: 'rollManual', sure: false,
        why: 'an 8500 die on Manual Rolling, which is where vent stock starts' };
    }
    return { track: null };
  }
  if (m === 'fom2') {
    return { track: 'widths', at: 'fom2', sure: true, why: 'on FOM 2, the widths machine' };
  }
  if (m === 'saw') {
    return { track: 'heights', at: 'sawHeights', sure: true, why: 'on the Elumatec saw' };
  }
  if (m === 'multipunch') {
    return { track: 'heights', at: 'multiPunch', sure: true, why: 'on the Multi Punch' };
  }
  if (m === 'roll-auto') {
    /* Still window wall, not yet split into widths and heights.

       High thermal is deliberately *not* used to split it. On the flowchart
       that question is asked only once material is already on the widths line,
       and plenty of HT dies are heights — SA80-106HT is a vertical male frame,
       which goes to the saw. Reading HT as "width" here would have sent a
       third of auto rolling to FOM 2 by mistake. */
    if (isSawWidthDie(task.die)) {
      return { track: 'widths', at: 'rollAuto', sure: true,
        why: 'the SOP names this die on the widths line' };
    }
    // The section book does say which way a member runs, where the description
    // bothers to. A hint, offered as one.
    const o = orientationOf(task.die);
    if (o) {
      return { track: o === 'width' ? 'widths' : 'heights', at: 'rollAuto', sure: false,
        why: `the section book calls this die ${o === 'width' ? 'horizontal' : 'vertical'}` };
    }
    return { track: 'ww', at: 'rollAuto', sure: false,
      why: 'on Auto Rolling — widths and heights split after this' };
  }
  return { track: null, at: null, sure: false, why: null };
}

/** Every station this line passes through under the SOP, in order.

    Returns null where the SOP does not cover the line — the CNC sheet's own
    work, anything that is not window wall or vents — rather than inventing a
    route for it. Those keep the learned suggestion, which is what it is for. */
export function routeFor(task) {
  if (!task) return null;
  const c = classify(task);
  if (!c.track) return null;

  let steps;
  let rule;

  if (c.track === 'vents') {
    steps = ['rollManual', 'fom3', 'ventAssembly'];
    rule = 'Vents run as a separate entity: manual rolling, then FOM 3, then straight to vent assembly.';
  } else if (c.track === 'heights') {
    const fmc = needsFmc(task);
    steps = ['rollAuto', 'sawHeights', 'multiPunch', ...(fmc ? ['fmc'] : []), 'assembly'];
    rule = fmc
      ? `Heights: saw, punch, then FMC — ${fmc}.`
      : 'Heights: Elumatec saw, then Multi Punch. No pin holes, ISV or SA80.235/236, so no FMC.';
  } else if (c.track === 'widths') {
    if (isHighThermal(task.die)) {
      steps = ['rollAuto', 'fom2', 'assembly'];
      rule = 'High thermal goes only to FOM 2 — it skips the saw and the widths punch.';
    } else if (isSawWidthDie(task.die)) {
      steps = ['rollAuto', 'sawWidths', 'widthsPunch', 'assembly'];
      rule = `${dieForms(task.die).sa} is one of the five dies that do go through the saw `
        + 'and the widths punch.';
    } else {
      steps = ['rollAuto', 'fom2', 'assembly'];
      rule = 'Not high thermal and not one of the five saw dies, so it goes straight to '
        + 'FOM 2 — skipping the saw and the widths punch.';
    }
  } else {
    steps = ['rollAuto'];
    rule = 'Auto rolling first. Which way it goes after that depends on whether it is '
      + 'cut as a width or a height.';
  }

  const at = steps.indexOf(c.at);
  return {
    track: c.track,
    sure: c.sure,
    why: c.why,
    rule,
    steps: steps.map((k) => ({ ...STEP[k], key: k })),
    at,                                   // -1 when the line is not on a step of its own route
    next: at >= 0 && at + 1 < steps.length ? { ...STEP[steps[at + 1]], key: steps[at + 1] } : null,
  };
}

/** Why this height needs an FMC after the punch, or null. Pin holes are a
    workbook column; ISV is written into the free text; the two dies are the
    SOP's own list. */
export function needsFmc(task) {
  const pin = String(task.pinHole || '').toUpperCase();
  if (pin === 'P:Y' || pin === 'Y' || pin === 'YES') return 'pin holes';
  const { sa } = dieForms(task.die);
  if (sa && FMC_DIES.has(sa)) return `die ${sa}`;
  if (/\bISV\b/i.test([task.comments, task.setup, task.material].filter(Boolean).join(' '))) return 'ISV';
  return null;
}

/** The machine the SOP puts this line on, when that is a machine in the line's
    own centre and it is not already there. Shaped like the learned suggestion
    so a line can offer either, and carries the rule so the row can say why.

    Only ever a suggestion. Routing a line to the wrong machine costs real time,
    and the person reading the row is the one who knows whether the sheet is
    wrong or this job is the exception. */
export function sopMachine(task, group) {
  const r = routeFor(task);
  if (!r) return null;

  // The step it should be at, within this centre. Rolling and assembly are not
  // decisions anybody makes on a queue, so they are not offered.
  const candidates = r.steps.filter((s) => s.machine && s.machine !== task.machine);
  for (const s of candidates) {
    if (MACHINE_CENTRE[s.machine] !== group) continue;
    // A height already past the saw should not be sent back to it.
    if (r.at >= 0 && r.steps.indexOf(s) < r.at) continue;
    return { machine: s.machine, station: s.station, rule: r.rule, sure: r.sure, sop: true };
  }
  return null;
}

/* Which centre each station's machine belongs to. Kept here rather than
   imported from machines.js to avoid a cycle — model.js imports both. */
const MACHINE_CENTRE = {
  'roll-auto': 'Rolling', 'roll-man': 'Rolling',
  fom1: 'FOM', fom2: 'FOM', fom3: 'FOM',
  cncfmc: 'CNC', cnc1: 'CNC', fmc1: 'CNC', fmc2: 'CNC',
  multipunch: 'Punch', saw: 'Punch',
};

export { STEP as SOP_STEPS };
