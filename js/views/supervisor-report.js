import { state } from '../store.js';
import { today, machineConfig } from '../model.js';
import { MACHINES } from '../machines.js';
import { el, modal, download, printDocument } from '../ui.js';
import { lossMinutesOn, reportCsv, validCalendarDate } from '../floor-operations.js';

function completedOn(item, date, now) {
  if (!item.done || !item.doneAt) return false;
  const at = new Date(item.doneAt);
  return Number.isFinite(+at) && +at <= +now && today(at) === date;
}
export const REPORT_NOTE = 'Calendar-day totals in this device’s timezone, not shift totals. Running timers are measured through report generation. Incident minutes may overlap. Zero means no recorded amount, not a confirmed loss-free day. Counts are reports, not defects or OEE. Historical production targets are not inferred from the current schedule.';

export function supervisorSummary(from, to, now = new Date()) {
  if (!validCalendarDate(from) || !validCalendarDate(to) || from > to) throw new Error('Choose a valid date range.');
  if (to > today(now)) throw new Error('Report dates cannot be in the future.');
  const dates = [];
  for (let day = new Date(from + 'T00:00:00'); day <= new Date(to + 'T00:00:00'); day.setDate(day.getDate() + 1)) {
    dates.push(`${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`);
    if (dates.length > 31) throw new Error('Choose up to 31 days.');
  }
  if (!dates.length) throw new Error('Choose a valid date range.');
  const records = Object.values(state.todos || {});
  const daily = dates.map(date => {
    const losses = records.filter(t => t.operation?.kind === 'downtime');
    return [date,
      Math.round(losses.filter(t => !t.operation.planned).reduce((n,t) => n + lossMinutesOn(t,date,now),0)),
      Math.round(losses.filter(t => t.operation.planned).reduce((n,t) => n + lossMinutesOn(t,date,now),0)),
      losses.filter(t => t.date === date && !t.operation.timer && t.operation.minutes == null).length,
      records.filter(t => t.date === date && t.operation?.kind === 'quality').length,
      records.filter(t => completedOn(t, date, now)).length];
  });
  const incidents = records.filter(t => t.operation?.kind === 'downtime').map(t => ({
    machine: machineConfig(MACHINES.find(m => m.key === t.operation.machine) || { key: t.operation.machine, label: t.operation.machine || 'Department' }).label,
    reason: t.operation.reason || 'Other', minutes: dates.reduce((n,d) => n + lossMinutesOn(t,d,now),0),
  })).filter(t => t.minutes > 0);
  const totals = new Map();
  for (const incident of incidents) {
    const key = `${incident.machine} · ${incident.reason}`;
    totals.set(key, (totals.get(key) || 0) + incident.minutes);
  }
  const recordCount = records.filter(t => (t.date >= from && t.date <= to)
    || dates.some(date => completedOn(t, date, now) || (t.operation?.kind === 'downtime' && lossMinutesOn(t, date, now) > 0))).length;
  return { daily, recordCount, causes: [...totals].sort((a,b) => b[1]-a[1]).map(([key,minutes]) => [key,Math.round(minutes)]),
    open: records.filter(t => !t.done && t.date <= today(now)).length };
}
export function openSupervisorReport() {
  const end = today(); const beginning = new Date(end + 'T00:00:00'); beginning.setDate(beginning.getDate()-6);
  const start = `${beginning.getFullYear()}-${String(beginning.getMonth()+1).padStart(2,'0')}-${String(beginning.getDate()).padStart(2,'0')}`;
  const from = el('input', {type:'date',value:start,'aria-label':'Report from'});
  const to = el('input', {type:'date',value:end,max:end,'aria-label':'Report through'});
  const body = el('div.supervisor-report-body'); const error = el('p',{role:'alert'});
  const headers = ['Date','Unplanned min','Planned min','Unmeasured reports','Quality reports','Reports resolved'];
  const table = (titles, rows) => el('div.report-table-wrap', {}, el('table', {}, el('thead',{},el('tr',{},...titles.map(t=>el('th',{scope:'col'},t)))),el('tbody',{},...rows.map(row=>el('tr',{},...row.map(v=>el('td',{},String(v))))))));
  let result;
  const refresh = () => {
    try {
      result = supervisorSummary(from.value,to.value); error.textContent='';
      body.replaceChildren(el('h3',{},'Recorded daily activity'),
        el('p',{}, result.recordCount ? `${result.recordCount} report records contribute to this period. Entries may be incomplete.` : 'No report records for this period. These zeros do not confirm there were no losses or quality issues.'),
        table(headers,result.daily),el('h3',{},'Largest reported downtime causes'),table(['Machine / reason','Minutes'],result.causes),
        ...(!result.causes.length ? [el('p',{},'No measured downtime recorded in this period.')] : []),
        el('p',{},`${result.open} reports remain open now (all dates, not just this range).`),el('p.small.muted',{},REPORT_NOTE));
    } catch(e) { result=null; body.replaceChildren(); error.textContent=e.message; }
  };
  from.onchange=refresh; to.onchange=refresh; refresh();
  modal('Supervisor report',el('div',{},el('div.command-form-grid',{},el('label',{},'From',from),el('label',{},'Through',to)),error,body),{wide:true,actions:[
    {label:'Export CSV',onClick:()=>{refresh();if(result)download(`supervisor-report-${from.value}-${to.value}.csv`,reportCsv([headers,...result.daily,[],['Machine / reason','Minutes'],...result.causes,[],['Interpretation',REPORT_NOTE],['Report records in period',result.recordCount],['Open reports now (all dates)',result.open]]),'text/csv;charset=utf-8');}},
    {label:'Print / Save PDF',onClick:()=>{refresh();if(result)printDocument({title:'Supervisor report',subtitle:`${from.value} to ${to.value}`,body:body.cloneNode(true),landscape:true});}},
  ]});
}
