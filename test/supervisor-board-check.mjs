/* Supervisor dashboard counts, the shift-update draft, and the window-wall
   sheet. Run: node test/supervisor-board-check.mjs */

import { state } from '../js/store.js';
import { addManualTask } from '../js/store.js';
import {
  applyShiftWindow, buildShiftDraft, centreShiftProgress, machineShiftNotes,
  shipWeekStart, windowWallSheet, WINDOW_WALL_FIELDS,
  supervisorBoard,
} from '../js/supervisor-board.js';
import { shiftContextAt } from '../js/shifts.js';

const afternoon = shiftContextAt('2026-08-14', new Date(2026, 7, 14, 16, 0));
if (afternoon.key !== 'AFT' || afternoon.date !== '2026-08-14' || !afternoon.shift.range.includes('15:30')) {
  throw new Error('afternoon 15:30–00:00 was not the current shift at 16:00');
}
const afterMidnight = shiftContextAt('2026-08-15', new Date(2026, 7, 15, 1, 30));
if (afterMidnight.key !== 'NIGHT' || afterMidnight.date !== '2026-08-14') {
  throw new Error('a morning after midnight did not stay on the shift that started the evening before');
}

const progress = centreShiftProgress([
  { group: 'Rolling', cuttingDate: '2026-08-14', status: 'DONE', parked: false, qty: 4 },
  { group: 'Rolling', cuttingDate: '2026-08-14', status: 'NOT_STARTED', parked: false, qty: 6 },
  { group: 'Rolling', cuttingDate: '2026-08-14', status: 'DONE', parked: true, qty: 99 },
  { group: 'Rolling', cuttingDate: '2026-08-13', status: 'DONE', parked: false, qty: 1 },
  { group: 'FOM', cuttingDate: '2026-08-14', status: 'DONE', parked: false, qty: 2 },
  { group: 'CNC', cuttingDate: '2026-08-14', status: 'IN_PROGRESS', parked: false, qty: 8 },
  { group: 'Punch', cuttingDate: '2026-08-14', status: 'NOT_STARTED', parked: false, qty: 1 },
], '2026-08-14');
const rolling = progress.find((centre) => centre.group === 'Rolling');
const fom = progress.find((centre) => centre.group === 'FOM');
const cnc = progress.find((centre) => centre.group === 'CNC');
if (progress.length !== 4 || progress.map((centre) => centre.label).join(',') !== 'Rolling,FOM,CNC & FMC,Multi Punch') {
  throw new Error('the four centres are not on the dashboard');
}
if (rolling.plan !== 2 || rolling.done !== 1 || rolling.planQty !== 10 || rolling.doneQty !== 4) {
  throw new Error('parked and other-day lines changed the Rolling plan: ' + JSON.stringify(rolling));
}
if (fom.done !== 1 || fom.plan !== 1 || cnc.done !== 0 || cnc.plan !== 1) {
  throw new Error('done versus plan is wrong for FOM or CNC');
}

const notes = machineShiftNotes({
  done: [{ wo: '100', project: 'Pier' }],
  running: [{ wo: '200', project: 'Dock' }],
  backOrders: [{ wo: '300', project: 'Tower', qty: 5 }],
});
if (notes.ops !== '1' || !notes.done.includes('100 Pier') || !notes.done.includes('200 Dock I.P') || notes.notes !== 'B/O 300 Tower 5 short') {
  throw new Error('shift notes were not filled from completed work and shortages: ' + JSON.stringify(notes));
}

if (shipWeekStart('2026-08-14') !== '2026-08-10') throw new Error('Friday did not fall in the week of Monday 10 Aug');
if (shipWeekStart('') !== '' || shipWeekStart('not-a-date') !== '') throw new Error('a missing ship date invented a week');

const sheet = windowWallSheet([
  { section: 'WINDOW WALL', wo: '1', qty: 2, shipDate: '2026-08-14', project: 'A' },
  { section: 'window wall.', wo: '2', qty: 3, shipDate: '2026-08-11', project: 'B' },
  { section: 'IN CUTTING', wo: '9', qty: 8, shipDate: '2026-08-14' },
  { section: 'WINDOW WALL', wo: '3', qty: 1, shipDate: null, project: 'C' },
]);
if (sheet.length !== 2 || sheet[0].label !== 'Week of 2026-08-10' || sheet[0].qty !== 5 || sheet[0].rows.length !== 2) {
  throw new Error('window wall rows were not grouped by ship week: ' + JSON.stringify(sheet));
}
if (sheet[1].label !== 'No ship date' || sheet[1].qty !== 1) throw new Error('an undated window wall row was dropped');
const expectedColumns = 'W/O,Job #,Project,Floor,Qty,Assembly,Vents,Deframes,Ship Date,Cutting,Warehouse,Cut,HTS,Widths,Punch,VTML,SFS,LVRS/TC PAN';
if (WINDOW_WALL_FIELDS.map(([, label]) => label).join(',') !== expectedColumns) {
  throw new Error('Window Wall print columns are missing or out of order');
}
if (WINDOW_WALL_FIELDS.length !== 18 || WINDOW_WALL_FIELDS.some(([key]) => !key)) {
  throw new Error('Window Wall print fields are incomplete');
}

state.tasks = [{
  machine: 'roll-auto', wo: '440', die: 'S1', qty: 4, project: 'Pier', cuttingDate: '2026-08-14', source: 'rolling',
}, {
  machine: 'fom1', wo: '441', die: 'S2', qty: 1, project: 'Dock', cuttingDate: '2026-08-13', source: 'cnc',
}];
state.manualTasks = {};
state.taskStatus = {};
state.taskHistory = [];
state.backOrder = {};
state.todos = { t1: { id: 't1', text: 'Call the mill', date: '2026-08-14', done: false, at: '2026-08-14T12:00:00.000Z' } };
const [from] = applyShiftWindow('2026-08-14', 'AFT');
const at = new Date(from + 60_000).toISOString();
state.taskHistory = [{ id: 'h1', kind: 'status', key: 'roll-auto|440|S1', at, to: 'DONE', from: 'NOT_STARTED' }];
state.taskStatus = { 'roll-auto|440|S1': { status: 'DONE', at } };
state.backOrder = {
  'fom1|441|S2': { flagged: true, qty: 2, assignee: 'Sam', note: 'bars', at },
};
const draft = buildShiftDraft('2026-08-14', 'AFT');
if (!draft.rows['roll-auto']?.done.includes('440 Pier') || draft.rows['roll-auto'].ops !== '1') {
  throw new Error('the shift draft missed the job finished this shift: ' + JSON.stringify(draft.rows['roll-auto']));
}
if (!draft.notes.includes('Call the mill')) throw new Error('an open to-do was left out of the shift summary');

const board = supervisorBoard('2026-08-14', new Date(2026, 7, 14, 16, 0));
if (board.centres.find((centre) => centre.group === 'Rolling').done !== 1) {
  throw new Error('the live board did not count the finished Rolling line');
}
if (!board.backOrders.length) throw new Error('the live board dropped the back order');

addManualTask({ machine: 'fom1', wo: 'keep-me', die: 'X', qty: 1, project: 'Stored' });
if (!state.manualTasks || !Object.values(state.manualTasks).some((task) => task.wo === 'keep-me')) {
  throw new Error('removing the manual-job screen deleted the stored job');
}

console.log('Supervisor board: OK');
