/* Business rules that turn schedule facts into material requirements.

   FOM 2's fifth column is shared by two different signals: ordinary pin-hole
   work (P:Y) and an explicit 8560 vent marker. They are not interchangeable.
   Only a cell that actually names 8560 / 8560 HT creates a hinge requirement.

   The department's confirmed rule is one hinge per 8560 vent. The scheduled
   row quantity is the vent count, so the requirement is deliberately 1:1 and
   remains traceable to the exact source row. */

export const HINGES_PER_8560_VENT = 1;

export function is8560VentTask(task) {
  if (!task || task.archived || task.machine !== 'fom2') return false;
  return /(?:^|\b)8560(?:\s*HT)?(?:\b|$)/i.test(String(task.pinHole || '').trim());
}

export function hingeRequirement(task) {
  if (!is8560VentTask(task)) return null;
  const quantity = Number(task.qty);
  const vents = Number.isFinite(quantity) && quantity > 0 ? quantity : null;
  return {
    task,
    vents,
    hinges: vents == null ? null : vents * HINGES_PER_8560_VENT,
    rate: HINGES_PER_8560_VENT,
    source: String(task.pinHole || '').trim(),
  };
}
