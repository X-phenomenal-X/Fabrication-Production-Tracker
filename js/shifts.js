/* Shift pattern. Day and Afternoon run full operations; Midnight runs a
   3-person crew. Used only to label the current shift in the header. */

export const SHIFTS = {
  DAY: { key: 'DAY', label: 'Day', from: 7, to: 15, full: true },
  AFT: { key: 'AFT', label: 'Afternoon', from: 15, to: 23, full: true },
  NIGHT: { key: 'NIGHT', label: 'Midnight', from: 23, to: 7, full: false, crew: 3 },
};

export const SHIFT_ORDER = ['DAY', 'AFT', 'NIGHT'];

export function shiftAt(date = new Date()) {
  const h = date.getHours();
  if (h >= 7 && h < 15) return 'DAY';
  if (h >= 15 && h < 23) return 'AFT';
  return 'NIGHT';
}
