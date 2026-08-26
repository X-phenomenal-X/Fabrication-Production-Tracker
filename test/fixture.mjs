/* A sanitized development fixture.

   Visual work needs a populated app, and the real workbooks carry live customer
   names and work orders. This builds a snapshot in exactly the shape
   `store.js` persists — so it can be dropped straight into localStorage — with
   invented projects, dies and people, at production volume.

   Every state the interface has to hold up under is present by construction:
   running, overdue, rush (assigned and not), back order (sheet-derived, hand
   flagged, and hand cleared), edited, moved between machines, machine down,
   completed, notes both short and far too long, and names long enough to test
   wrapping. Deterministic — same fixture every run, so screenshots only change
   when the design does. */

const MACHINES = [
  'roll-auto', 'roll-man', 'fom1', 'fom2', 'fom3',
  'cncfmc', 'cnc1', 'fmc1', 'fmc2', 'multipunch',
];

const SHEET_OF = {
  'roll-auto': 'Auto', 'roll-man': 'Manual',
  fom1: 'FOM1', fom2: 'FOM2', fom3: 'FOM3',
  cncfmc: 'CNC & FMC', cnc1: 'CNC & FMC', fmc1: 'CNC & FMC', fmc2: 'CNC & FMC',
  multipunch: 'MultiPunch & SAW',
};

/* Invented towers. The last one is deliberately absurd: a real schedule does
   carry names this long, and a layout that only works on "Elm Court" is not
   finished. */
const PROJECTS = [
  'Harbour Point', 'Elm Court', 'Station Square', 'Maple Ridge PH1',
  'Maple Ridge PH2', 'Riverbend', 'Northgate', 'Copperfield',
  'The Foundry', 'Kingsway West', 'Lakeshore Commons',
  'Bayfront Residences at Old Mill Crossing — Phase 3 Podium & Amenity Level',
];

const FLOORS = [
  '12A', '3C, 4C', 'PH-N', '27C, 28C, C-LMPH, C-UMPH', 'L2', 'M1, M2',
  'Level 6 through Level 11 inclusive, north and west elevations',
];

const DIES = [
  'S80.104', 'S80.234', 'K1285', 'B44.010', 'S80.117', 'T22.906',
  'B44.221', 'S80.301', 'M17.044', 'K1285-R2',
];

const PEOPLE = ['Abhay', 'Marek', 'Sunil', 'Dee', 'Rob', 'Krystyna Wojciechowska'];

const NOTES = [
  'Bars staged at the saw.',
  'Waiting on the shipper.',
  'Short 4 — rest cut, will finish next shift.',
  'Do not run until the die is cleaned, it marked the last batch on the outside face and the whole lot had to be re-run on afternoons.',
  'Ask Marek before starting, there is a revision coming.',
];

/* A tiny deterministic PRNG, so the fixture is byte-identical every run and a
   screenshot diff means the design changed rather than the data did. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const DAY = 86400000;

export function makeFixture({ today = '2026-08-14', volume = 'heavy' } = {}) {
  const r = rng(20260814);
  const base = Date.parse(today + 'T12:00:00Z');
  const iso = (d) => new Date(d).toISOString();
  const day = (offset) => new Date(base + offset * DAY).toISOString().slice(0, 10);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];

  const perMachine = volume === 'heavy' ? 78 : 12;

  const tasks = [];
  const taskStatus = {};
  const taskNote = {};
  const taskEdit = {};
  const backOrder = {};
  const rush = {};
  const taskAssign = {};
  const taskHistory = [];

  const key = (t) => `${t.machine}|${t.wo}|${t.die || ''}`;

  let wo = 31500;
  for (const machine of MACHINES) {
    for (let i = 0; i < perMachine; i++) {
      wo += 1 + Math.floor(r() * 3);
      const die = pick(DIES);
      // A spread of dates either side of today, so every date bucket the queue
      // builds — overdue, today, this week, later, none — has rows in it.
      const offset = Math.floor(r() * 15) - 6;
      const hasDate = r() > 0.12;
      const t = {
        id: `${machine}:${wo}:${die}:${i + 10}`,
        machine,
        sheet: SHEET_OF[machine],
        row: i + 10,
        wo: String(wo),
        project: pick(PROJECTS),
        floor: pick(FLOORS),
        die,
        qty: 4 + Math.floor(r() * 260),
        status: null,
        cuttingDate: hasDate ? day(offset) : null,
        shipDate: hasDate ? day(offset + 7) : null,
        material: null,
        comments: r() > 0.88 ? 'Rev D — check the tag before cutting' : null,
        setup: null,
        rollingEta: null,
        dayShift: null,
        shifts: null,
        pinHole: null,
        bo: null,
        boRaw: null,
        boStat: null,
        backOrder: false,
        archived: false,
      };

      // Sheet-derived shortages, the ones that arrive already flagged.
      if (r() > 0.93) {
        t.backOrder = true;
        t.bo = 1 + Math.floor(r() * 6);
        t.boRaw = String(t.bo);
        t.boStat = r() > 0.5 ? 'IP BO' : 'ordered 8/11';
      }

      tasks.push(t);
      const k = key(t);

      // Status. Roughly a fifth of each machine's book is running and a third
      // is finished — close to what the real workbooks look like mid-week.
      const roll = r();
      if (roll > 0.80) {
        taskStatus[k] = {
          status: 'IN_PROGRESS',
          at: iso(base - Math.floor(r() * 9) * 3600000),
          by: pick(PEOPLE),
        };
      } else if (roll > 0.48) {
        taskStatus[k] = {
          status: 'DONE',
          at: iso(base - Math.floor(r() * 40) * 3600000),
          by: pick(PEOPLE),
        };
      }

      if (r() > 0.90) {
        taskNote[k] = { text: pick(NOTES), at: iso(base - 5400000), by: pick(PEOPLE) };
      }

      // Rush, with and without an owner, and with need-by dates either side of
      // today so the Rush page has something in every bucket.
      if (r() > 0.93) {
        const needOffset = Math.floor(r() * 9) - 3;
        rush[k] = {
          on: true,
          needBy: r() > 0.15 ? day(needOffset) : null,
          assignee: r() > 0.35 ? pick(PEOPLE) : null,
          reason: r() > 0.4 ? 'Shipping gate Friday — trucks booked.' : null,
          at: iso(base - 7200000),
          by: pick(PEOPLE),
        };
      }

      // Hand-recorded shortages, including the tri-state's third leg: a line
      // the sheet still flags that someone has since cleared.
      if (t.backOrder && r() > 0.6) {
        backOrder[k] = {
          flagged: r() > 0.25 ? true : false,
          qty: Math.floor(r() * 40),
          assignee: r() > 0.3 ? pick(PEOPLE) : null,
          note: r() > 0.5 ? 'Mill says week of the 25th.' : null,
          at: iso(base - 10800000),
          by: pick(PEOPLE),
        };
      } else if (r() > 0.975) {
        backOrder[k] = {
          flagged: true, qty: 12, assignee: 'Krystyna Wojciechowska',
          note: 'Found short at the saw — not on the sheet.',
          at: iso(base - 3600000), by: 'Marek',
        };
      }

      if (r() > 0.95) {
        taskEdit[k] = {
          fields: { qty: t.qty + 10 },
          at: iso(base - 14400000),
          by: pick(PEOPLE),
        };
      }
    }
  }

  /* One job at three stations, with the stations disagreeing — which is what
     the real workbooks look like, because each sheet is kept by a different
     person and they fall behind at different rates.

     W/O 39001 S80.104 is rolled, cut at FOM 2 and punched. The punch says it
     is finished; rolling still says it is running and FOM 2 has not been
     touched at all. Both of those earlier rows are stale, and the app has to
     work that out rather than count the job as open three times over. */
  const STALE_WO = '39001';
  const STALE_DIE = 'S80.104';
  const staleRow = (machine, status, row) => ({
    id: `${machine}:${STALE_WO}:${STALE_DIE}:${row}`,
    machine, sheet: SHEET_OF[machine], row,
    wo: STALE_WO, project: 'Harbour Point', floor: 'L2',
    die: STALE_DIE, qty: 88, status,
    cuttingDate: day(-2), shipDate: day(5),
    material: null, comments: null, setup: null, rollingEta: null,
    dayShift: null, shifts: null, pinHole: null,
    bo: null, boRaw: null, boStat: null, backOrder: false, archived: false,
  });
  tasks.push(
    staleRow('roll-auto', 'IP', 90),      // stale: says still rolling
    staleRow('fom2', null, 91),           // stale: says never started
    staleRow('multipunch', 'DONE', 92),   // the one that is right
  );

  // Lines moved off the machine the workbook put them on: the whole CNC queue
  // has to be assigned by hand, and FOM work gets shuffled during a shift.
  const queued = tasks.filter((t) => t.machine === 'cncfmc');
  queued.forEach((t, i) => {
    if (i % 3 === 0) return;                       // some stay unassigned
    taskAssign[key(t)] = {
      machine: ['cnc1', 'fmc1', 'fmc2'][i % 3],
      at: iso(base - 18000000), by: pick(PEOPLE),
    };
  });
  tasks.filter((t) => t.machine === 'fom1').slice(0, 5).forEach((t) => {
    taskAssign[key(t)] = { machine: 'fom3', at: iso(base - 21600000), by: 'Dee' };
  });

  for (const [k, v] of Object.entries(taskStatus).slice(0, 40)) {
    taskHistory.push({
      id: k + ':h', key: k, kind: 'status', field: null,
      from: null, to: v.status, at: v.at, by: v.by,
    });
  }

  const suRow = (done, next, notes, ops, down) => ({
    ops, done, next, notes, down: !!down,
  });

  return {
    v: 2,
    tasks,
    machineMeta: {
      rolling: {
        fileName: 'Rolling_Schedule_2026.xlsx', importedAt: iso(base - 3 * 3600000),
        count: tasks.filter((t) => t.machine.startsWith('roll')).length, parser: 4,
      },
      cnc: {
        fileName: 'CNC_Schedule_Rev_E.xlsx', importedAt: iso(base - 3 * 3600000),
        count: tasks.filter((t) => !t.machine.startsWith('roll')).length, parser: 4,
      },
    },
    taskStatus,
    shiftUpdate: {
      date: day(0),
      shift: 'DAY',
      sheet: 'Shift Update',
      importedAt: iso(base - 3 * 3600000),
      machines: {
        'roll-auto': suRow(
          ['Harbour Point 12A (S80.104) — 180 pcs run', 'Elm Court 3C — finished'],
          ['Station Square PH-N', 'Maple Ridge PH2 27C'], [], 4, false),
        'roll-man': suRow(['Copperfield L2 (B44.010)'], ['Northgate M1, M2'], [], 4, false),
        fom1: suRow(['Riverbend — 60 of 210'], ['The Foundry L2'], ['Blade change at 10:30'], 1, false),
        fom2: suRow([], [], ['Down since 06:15 — waiting on the millwright for the infeed clamp.'], 1, true),
        fom3: suRow(['Kingsway West PH-N'], ['Lakeshore Commons'], [], 1, false),
        cnc1: suRow(['Elm Court 3C, 4C (K1285)'], ['Harbour Point 12A'], [], 1, false),
        fmc1: suRow(['Maple Ridge PH1'], ['Copperfield'], [], 1, false),
        fmc2: suRow([], ['Northgate'], ['Running short-staffed on afternoons'], 1, false),
        multipunch: suRow(['Station Square — 340 pcs'], [], [], 1, false),
        backorder: suRow([], [], ['S80.234 short 6 bars, mill week of the 25th'], null, false),
      },
    },
    taskNote,
    taskEdit,
    backOrder,
    rush,
    taskAssign,
    taskHistory,
    machineConfig: {},
    /* Two saved updates, deliberately straddling the workbook's own date.

       The older one loses to the workbook everywhere. The newer one covers
       only Rolling (Auto) and FOM 1, so those two machine pages must show what
       was written here while every other machine still shows the workbook —
       which is exactly the mix the department has after someone writes up a
       shift on a workbook that has not been re-saved. */
    shiftLogs: {
      [`${day(-1)}|AFT`]: {
        date: day(-1), shift: 'AFT',
        rows: {
          backorder: { notes: 'S80.234 still short.' },
          fom2: { ops: 1, done: 'Elm Court 3C', next: '', notes: '' },
        },
        notes: 'Quiet shift.', at: iso(base - 20 * 3600000), by: 'Marek',
      },
      [`${day(0)}|AFT`]: {
        date: day(0), shift: 'AFT',
        rows: {
          'roll-auto': {
            ops: 4,
            done: 'Harbour Point 12A (S80.104) — 180 done\nElm Court 3C — finished',
            next: 'Station Square PH-N\n61st Avenue Lv. 1/2',
            notes: 'Coil change at 18:00.',
          },
          fom1: {
            ops: 1,
            done: 'Riverbend — 210 of 210, done',
            next: 'The Foundry L2',
            notes: '',
          },
        },
        notes: 'Full crew on afternoons.', at: iso(base - 3600000), by: 'Sunil',
      },
    },
    /* Jobs the workbook does not have. One ordinary remake, one that the
       workbook has since caught up with — same machine, work order and die as
       an imported line, so it must be hidden from the queues rather than
       shown twice. */
    manualTasks: {
      m1: {
        id: 'manual:m1', manual: true, machine: 'fom2', sheet: 'Added by hand',
        row: null, wo: '90114', project: 'Elm Court', floor: 'PH-N',
        die: 'S80.117', qty: 6, status: null, cuttingDate: day(0), shipDate: null,
        material: null, comments: 'Remake for two broken pieces — site is waiting.',
        setup: null, rollingEta: null, dayShift: null, shifts: null, pinHole: null,
        bo: null, boRaw: null, boStat: null, backOrder: false, archived: false,
        at: iso(base - 5400000), by: 'Dee',
      },
      m2: {
        id: 'manual:m2', manual: true, machine: tasks[0].machine, sheet: 'Added by hand',
        row: null, wo: tasks[0].wo, project: tasks[0].project, floor: tasks[0].floor,
        die: tasks[0].die, qty: 10, status: null, cuttingDate: day(0), shipDate: null,
        material: null, comments: 'Added before the workbook had it.',
        setup: null, rollingEta: null, dayShift: null, shifts: null, pinHole: null,
        bo: null, boRaw: null, boStat: null, backOrder: false, archived: false,
        at: iso(base - 90000000), by: 'Marek',
      },
    },

    /* The day's list, including one carried over unfinished from yesterday and
       one already ticked off, so both states render. */
    todos: {
      t1: { id: 't1', text: 'Chase the mill on S80.234 — promised week of the 25th',
        date: day(-1), assignee: 'Krystyna Wojciechowska', done: false,
        at: iso(base - 100000000), by: 'Abhay' },
      t2: { id: 't2', text: 'Blade change on FOM 2 before afternoons',
        date: day(0), assignee: 'Marek', done: false, at: iso(base - 7200000), by: 'Abhay' },
      t3: { id: 't3', text: 'Walk the Bayfront podium drawings over to the office',
        date: day(0), assignee: null, done: false, at: iso(base - 3600000), by: 'Sunil' },
      t4: { id: 't4', text: 'Book the trailer for Friday', date: day(0),
        assignee: 'Abhay', done: true, doneAt: iso(base - 1800000), doneBy: 'Abhay',
        at: iso(base - 9000000), by: 'Abhay' },
    },

    people: PEOPLE,
    settings: { me: 'Abhay' },
  };
}

if (typeof process !== 'undefined' && import.meta.url === `file://${process.argv[1]}`) {
  const f = makeFixture();
  process.stdout.write(JSON.stringify(f));
}
