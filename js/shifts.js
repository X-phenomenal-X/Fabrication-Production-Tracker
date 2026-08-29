/* The department currently runs two production shifts. Minutes since midnight
   are used rather than whole hours because the handoff is at 15:30.

   NIGHT remains as a read-only legacy definition so an old saved update does
   not turn into an unknown code. It is deliberately absent from SHIFT_ORDER:
   no new Midnight update or staging target can be created from the UI. */

const breakAt = (from, to) => ({ from, to });

export const SHIFTS = {
  DAY: {
    key: 'DAY', label: 'Day', start: 7 * 60, end: 15 * 60 + 30,
    range: '07:00–15:30', full: true,
    breaks: [
      breakAt(9 * 60 + 15, 9 * 60 + 30),
      breakAt(12 * 60 + 30, 13 * 60),
      breakAt(14 * 60 + 15, 14 * 60 + 30),
    ],
  },
  AFT: {
    key: 'AFT', label: 'Afternoon', start: 15 * 60 + 30, end: 24 * 60,
    range: '15:30–00:00', full: true,
    breaks: [
      breakAt(18 * 60, 18 * 60 + 15),
      breakAt(20 * 60, 20 * 60 + 30),
      breakAt(23 * 60, 23 * 60 + 15),
    ],
  },
  NIGHT: {
    key: 'NIGHT', label: 'Midnight (historical)', start: 23 * 60, end: 7 * 60,
    range: '23:00–07:00', legacy: true, full: false, breaks: [],
  },
};

export const SHIFT_ORDER = ['DAY', 'AFT'];

const ALIASES = { AFTERNOON: 'AFT', MIDNIGHT: 'NIGHT' };

export function normalizeShift(value) {
  const key = String(value || '').trim().toUpperCase();
  return ALIASES[key] || key;
}

export function shiftLabel(value) {
  const key = normalizeShift(value);
  return SHIFTS[key]?.label || value || 'Unknown shift';
}

function clock(minutes) {
  const value = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

export function breakRanges(value) {
  const shift = SHIFTS[normalizeShift(value)];
  return (shift?.breaks || []).map((b) => `${clock(b.from)}–${clock(b.to)}`);
}

/** The active production shift, or null between midnight and 07:00. */
export function shiftAt(date = new Date()) {
  const minute = date.getHours() * 60 + date.getMinutes();
  return SHIFT_ORDER.find((key) => {
    const shift = SHIFTS[key];
    return minute >= shift.start && minute < shift.end;
  }) || null;
}

/** Which shift a moment belongs to for the purposes of naming a handoff, a
    shift update or a briefing — and never null, which is the difference
    between this and shiftAt().

    Production runs 07:00 to midnight in two shifts. Between midnight and 07:00
    nobody is on the floor, but the app is still opened then: by whoever comes
    in early, by a wall panel that never sleeps, and by anyone in a timezone the
    schedule was not written for. shiftAt() correctly answers "no shift is
    running"; a page that has to name a shift needs the shift that just ended,
    which in those hours is yesterday's Afternoon.

    `ref` is the shop date, passed in because the Toronto-date rule lives in
    model.js and model.js imports this file.

    Returns { key, date, shift, live } — `live` false when the answer is the
    shift that has ended rather than one in progress, so a page can say so
    rather than implying a crew is standing there. */
export function shiftContextAt(ref, now = new Date()) {
  const key = shiftAt(now);
  if (key) return { key, date: ref, shift: SHIFTS[key], live: true };

  const previous = new Date(now.getTime());
  previous.setDate(previous.getDate() - 1);
  const date = `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, '0')}`
    + `-${String(previous.getDate()).padStart(2, '0')}`;
  return { key: 'AFT', date, shift: SHIFTS.AFT, live: false };
}

/** Header-ready live state, including current/next break detail. */
export function shiftStatusAt(date = new Date()) {
  const minute = date.getHours() * 60 + date.getMinutes();
  const key = shiftAt(date);
  if (!key) {
    return {
      key: null, shift: null, onBreak: false, label: 'Off shift',
      detail: 'No production shift is active. Day shift starts at 07:00.',
    };
  }

  const shift = SHIFTS[key];
  const currentBreak = shift.breaks.find((b) => minute >= b.from && minute < b.to) || null;
  const nextBreak = shift.breaks.find((b) => b.from > minute) || null;
  const allBreaks = breakRanges(key).join(', ');
  const live = currentBreak
    ? `Break now ${clock(currentBreak.from)}–${clock(currentBreak.to)}.`
    : nextBreak
      ? `Next break ${clock(nextBreak.from)}–${clock(nextBreak.to)}.`
      : 'All scheduled breaks are complete.';

  return {
    key, shift, onBreak: !!currentBreak, currentBreak, nextBreak,
    label: `${shift.label}${currentBreak ? ' · Break' : ''}`,
    detail: `${shift.label} shift ${shift.range}. ${live} Breaks: ${allBreaks}.`,
  };
}
