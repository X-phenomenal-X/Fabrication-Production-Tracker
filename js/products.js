/* Job-level product reference, from the Product sheet of the CNC schedule.

   The Daily Schedule does not carry the vent system, so "does this job need
   hinges?" cannot be answered from it alone. The rule the department uses is
   that 8560 vents need hinges, and the vent system is recorded per job here.

   Seeded from the CNC workbook (Rev E) and editable in Setup, because it
   changes as jobs are added. */

export const PRODUCT_SEED = {
  '937':  { project: 'One Yonge PH2', vent: '8550', doors: '8950', ventType: 'Awning' },
  '996':  { project: 'Notting Hill', vent: '8550', doors: '8750', ventType: 'Awning' },
  '1086': { project: 'Stella', vent: '8550', doors: '8750', ventType: 'Awning' },
  '1124': { project: '5207 Dundas', vent: '8560 HT', doors: '8760HT', ventType: 'Awning' },
  '1044': { project: 'Alt Jackson', vent: '8550', doors: '8950', ventType: 'Awning' },
  '5033': { project: 'The Groove', vent: '8550', doors: '8760' },
  '1093': { project: 'Town & Center', vent: '8560', doors: '8760', ventType: 'Casement/Awning' },
  '1113': { project: 'South Yards', vent: '8550', doors: '8760', ventType: 'Awning/Casement' },
  '1132': { project: 'South of Quinpool', vent: '8550', doors: '8950', ventType: 'Awning' },
  '1084': { project: 'Sovereign W', vent: '8550', doors: '8760', ventType: 'Casement' },
  '1040': { project: '810 Agnes W', vent: '8550', doors: '8760', ventType: 'Awning' },
  '1074': { project: 'Millennium Springer', vent: '8500R', doors: '8950', ventType: 'Awning' },
  '1128': { project: 'Fundy Quay', vent: '8550', doors: '8760', ventType: 'Awning' },
  '1046': { project: 'Capstan K', vent: '8550', doors: '8750', ventType: 'Awning/Casement' },
  '1107': { project: 'Lakeside', vent: '8560', doors: '8760', ventType: 'Awning' },
  '1131': { project: 'Wall Centre Surrey', vent: '8560', doors: '8760', ventType: 'Awning' },
  '1144': { project: 'The New Merchant', vent: '8550', doors: 'NA', ventType: 'Awning' },
  '1122': { project: 'GEC Oakridge', vent: '8550HT', doors: '8760HT', ventType: 'Awning' },
  '1145': { project: 'Richmond Yard', vent: '8550', doors: '8760', ventType: 'Awning' },
};

/** 8560 vents need hinges. Covers 8560 and 8560 HT. */
export function needsHinges(ventSystem) {
  return /^8560/i.test(String(ventSystem || '').trim());
}

export function productFor(job, overrides) {
  if (!job) return null;
  const key = String(job).trim();
  const o = overrides?.[key];
  if (o) return o;
  return PRODUCT_SEED[key] || null;
}
