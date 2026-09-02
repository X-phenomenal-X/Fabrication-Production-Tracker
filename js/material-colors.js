/* Shared file-picker action for the Projects page and Setup. Kept separate so
   importing the large workbook parser remains behind an explicit user action. */

import { el, fmtNum, modal, toast } from './ui.js';
import { setProjectColorReference } from './store.js';

export async function loadMaterialColorFile(file, rerender) {
  toast(`Reading ${file.name}…`, 60000);
  try {
    const { importMaterialColors } = await import('./import-material-colors.js');
    const result = await importMaterialColors(await file.arrayBuffer(), { fileName: file.name });
    setProjectColorReference(result);
    const report = result.report;
    modal(`Imported ${file.name}`, el('div', {},
      el('div.stats.import-stats', {},
        el('div.stat', {}, el('div.n', {}, fmtNum(report.projects)), el('div.k', {}, 'Projects')),
        el('div.stat', {}, el('div.n', {}, fmtNum(report.workOrders)), el('div.k', {}, 'Work orders')),
        el('div.stat', {}, el('div.n', {}, fmtNum(report.colors)), el('div.k', {}, 'Finishes'))),
      el('p.small.muted', {}, `${fmtNum(report.count)} colour entries were aggregated from ${report.sheets.map((item) => item.sheet).join(' and ')}. The source rows were not saved.`)));
    toast(`Added colours for ${fmtNum(report.projects)} projects`);
    rerender();
  } catch (error) {
    modal('Import failed', el('div', {},
      el('p', {}, error.message),
      el('p.small.muted', {}, 'Nothing already loaded has been changed. Choose the populated Material Requests workbook, not the blank request form.')));
  } finally {
    document.querySelectorAll('.toast').forEach((item) => item.remove());
  }
}

export function chooseMaterialColorFile(rerender) {
  const input = el('input', { type: 'file', accept: '.xlsx', style: { display: 'none' } });
  input.addEventListener('change', () => {
    if (input.files[0]) loadMaterialColorFile(input.files[0], rerender);
  });
  document.body.append(input);
  input.click();
  input.remove();
}
