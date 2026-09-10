import { el, modal } from '../ui.js';
import { openOperationDialog } from './command-center.js';
import { focusShiftUpdate } from './shiftupdate.js';
import { commandSnapshot } from '../command-center.js';

export function quickEntry(rerender, go) {
  return el('button.floor-quick-entry', {type:'button','aria-label':'Quick entry',onclick:()=> {
    modal('Quick entry',el('p',{},'Record a floor issue or prepare the handover.'),{actions:[
      ...[['downtime','Downtime'],['quality','Quality'],['action','Action']].map(([kind,label])=>({label,onClick:dlg=>{dlg.close();openOperationDialog(kind,rerender);}})),
      {label:'Handover',onClick:dlg=>{dlg.close();const {context}=commandSnapshot();focusShiftUpdate(context.date,context.key);go('shift');}},
    ]});
  }}, '+ Quick entry');
}
