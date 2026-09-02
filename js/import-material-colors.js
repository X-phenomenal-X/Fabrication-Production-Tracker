/* Project colour/finish reference from the existing Material Requests history.

   This is deliberately a narrow import. The workbook is not turned into an
   ordering or purchasing screen: only project/work-order-to-colour mappings
   are retained, and the source rows never enter app state. */

import { readXlsx } from './xlsx.js';
import { projectColorKey, projectWorkOrderKey } from './project-color-key.js';

export const MATERIAL_COLOR_PARSER_VERSION = 1;
const SHEETS = ['Material Requests', 'Completed Orders'];

const ALIASES = {
  workOrder: [/^W\s*\/?\s*O\s*#?$/, /^WORK\s*ORDER/, /^ORDER\s*(NO\.?|NUMBER|#)?$/],
  project: [/^PROJECT(\s*NAME)?$/, /^JOB\s*NAME$/],
  color: [/^COLOU?R$/, /^FINISH$/, /^COLOU?R\s*\/\s*FINISH$/],
};

function text(value) {
  if (value == null || value instanceof Date || typeof value === 'object') return null;
  const out = String(value).trim().replace(/\s+/g, ' ');
  return out || null;
}

function color(value) {
  let out = String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!out || /^(N\/?A|NONE|UNKNOWN|ANY|ANYFINISH|-)$/.test(out) || /^\d+(\.\d+)?$/.test(out)) return null;
  if (out === 'MILL' || out === 'MILLFINISH') return 'MILL FINISH';
  if (['PRETREAT', 'PRETRAIT', 'PRETRAET', 'PREATREAT'].includes(out)) return 'PRETREAT';
  if (/^(ANDOIZE|ANODIZE|ANODIZED)$/.test(out)) return 'ANODIZED';
  if (/^(UFCX|UCXF)/.test(out)) out = `UCFX${out.slice(4)}`;
  if (/^K-\d+$/.test(out)) out = out.replace('-', '');
  return out;
}

function columns(sheet) {
  const headings = [];
  for (const row of sheet.rows.filter((item) => item.r === 1)) {
    row.cells.forEach((value, index) => {
      const part = text(value);
      if (part) headings[index] = [headings[index], part].filter(Boolean).join(' ');
    });
  }
  const found = {};
  for (const [field, patterns] of Object.entries(ALIASES)) {
    const index = headings.findIndex((heading) => patterns.some((pattern) => pattern.test(String(heading).toUpperCase())));
    if (index >= 0) found[field] = index;
  }
  const missing = Object.keys(ALIASES).filter((field) => found[field] == null);
  if (missing.length) throw new Error(`${sheet.name || 'Sheet'} is missing ${missing.join(', ')} column${missing.length === 1 ? '' : 's'}.`);
  return found;
}

function increment(map, key, finish) {
  if (!map.has(key)) map.set(key, new Map());
  const colors = map.get(key);
  colors.set(finish, (colors.get(finish) || 0) + 1);
}

function compact(map) {
  return Object.fromEntries([...map.entries()].map(([key, colors]) => [key,
    [...colors.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([finish]) => finish),
  ]));
}

export async function importMaterialColors(arrayBuffer, { fileName = 'Material Requests.xlsx' } = {}) {
  const workbook = await readXlsx(arrayBuffer, { only: SHEETS, maxRows: 12000 });
  const missingSheets = SHEETS.filter((name) => !workbook.sheets[name]);
  if (missingSheets.length === SHEETS.length) {
    throw new Error(`This workbook has neither "${SHEETS[0]}" nor "${SHEETS[1]}". Sheets found: ${workbook.sheetNames.join(', ')}`);
  }

  const projects = new Map();
  const workOrders = new Map();
  const finishes = new Set();
  const sheetReport = [];
  let count = 0;
  let skipped = 0;

  for (const sheetName of SHEETS) {
    const sheet = workbook.sheets[sheetName];
    if (!sheet) continue;
    const cols = columns({ ...sheet, name: sheetName });
    let sheetCount = 0;
    for (const row of sheet.rows) {
      if (row.r <= 1 || row.empty) continue;
      const project = projectColorKey(text(row.cells[cols.project]));
      const workOrder = projectWorkOrderKey(text(row.cells[cols.workOrder]));
      const finish = color(row.cells[cols.color]);
      if (!finish || (!project && !workOrder)) { skipped++; continue; }
      if (project) increment(projects, project, finish);
      if (workOrder) increment(workOrders, workOrder, finish);
      finishes.add(finish);
      count++;
      sheetCount++;
    }
    sheetReport.push({ sheet: sheetName, rows: sheetCount });
  }

  if (!count) throw new Error('No project colour entries were found in the Material Requests workbook.');

  return {
    reference: {
      projects: compact(projects),
      workOrders: compact(workOrders),
    },
    report: {
      kind: 'project-colors',
      fileName,
      importedAt: new Date().toISOString(),
      parser: MATERIAL_COLOR_PARSER_VERSION,
      count,
      skipped,
      projects: projects.size,
      workOrders: workOrders.size,
      colors: finishes.size,
      sheets: sheetReport,
    },
  };
}
