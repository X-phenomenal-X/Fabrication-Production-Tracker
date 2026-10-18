/* The department runs three production shifts. Minutes since midnight are
   used rather than whole hours because the handoffs are not on the hour.

   Afternoon still ends at midnight. Midnight starts at 23:45, so the last
   fifteen minutes of Afternoon overlap the start of Midnight, and Day still
   starts at 07:00, fifteen minutes before Midnight's scheduled end. During
   an overlap the shift that already owns that boundary stays the active one.
   Midnight is what is running from midnight until Day starts.

   Saved logs use the key NIGHT. Older Midnight records (previously described
   as 23:00–07:00) keep that same key, so they still open. */

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
    key: 'NIGHT', label: 'Midnight', start: 23 * 60 + 45, end: 7 * 60 + 15,
    range: '23:45–07:15', full: true,
    breaks: [],
  },
};

export const SHIFT_ORDER = ['DAY', 'AFT', 'NIGHT'];

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

function covers(shift, minute) {
  if (shift.end > shift.start) return minute >= shift.start && minute < shift.end;
  return minute >= shift.start || minute < shift.end;
}

/** The active production shift. Afternoon keeps the floor through midnight,
    and Day takes over at 07:00, so the overlap at each end is not a second
    active crew. From 00:00 until 07:00 the active shift is Midnight. */
export function shiftAt(date = new Date()) {
  const minute = date.getHours() * 60 + date.getMinutes();
  const matches = SHIFT_ORDER.filter((key) => covers(SHIFTS[key], minute));
  if (!matches.length) return null;
  if (matches.length === 1) return matches[0];
  return matches.find((key) => SHIFTS[key].end > SHIFTS[key].start) || matches[0];
}

function isoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    + `-${String(date.getDate()).padStart(2, '0')}`;
}

function previousIso(now) {
  const previous = new Date(now.getTime());
  previous.setDate(previous.getDate() - 1);
  return isoDate(previous);
}

/** Which shift a moment belongs to for naming a handoff, a shift update or a
    briefing — and never null, which is the difference between this and shiftAt().

    `ref` is the shop date, passed in because the Toronto-date rule lives in
    model.js and model.js imports this file.

    Work logged after midnight on the Midnight shift belongs to the date that
    shift started, not the new calendar day.

    Returns { key, date, shift, live } — `live` false only when no shift covers
    the moment and the answer is the shift that has ended. */
export function shiftContextAt(ref, now = new Date()) {
  const key = shiftAt(now);
  if (key) {
    const shift = SHIFTS[key];
    const minute = now.getHours() * 60 + now.getMinutes();
    const startedYesterday = shift.end <= shift.start && minute < shift.end;
    return {
      key,
      date: startedYesterday ? previousIso(now) : ref,
      shift,
      live: true,
    };
  }

  return { key: 'AFT', date: previousIso(now), shift: SHIFTS.AFT, live: false };
}

/** Header-ready live state, including current/next break detail. */
export function shiftStatusAt(date = new Date()) {
  const minute = date.getHours() * 60 + date.getMinutes();
  const key = shiftAt(date);
  if (!key) {
    return {
      key: null, shift: null, onBreak: false, label: 'Off shift',
      detail: 'No production shift is active.',
    };
  }

  const shift = SHIFTS[key];
  const currentBreak = shift.breaks.find((b) => minute >= b.from && minute < b.to) || null;
  const nextBreak = shift.breaks.find((b) => b.from > minute) || null;
  const allBreaks = breakRanges(key).join(', ');
  const live = !shift.breaks.length
    ? 'No scheduled breaks.'
    : currentBreak
      ? `Break now ${clock(currentBreak.from)}–${clock(currentBreak.to)}.`
      : nextBreak
        ? `Next break ${clock(nextBreak.from)}–${clock(nextBreak.to)}.`
        : 'All scheduled breaks are complete.';

  return {
    key, shift, onBreak: !!currentBreak, currentBreak, nextBreak,
    label: `${shift.label}${currentBreak ? ' · Break' : ''}`,
    detail: shift.breaks.length
      ? `${shift.label} shift ${shift.range}. ${live} Breaks: ${allBreaks}.`
      : `${shift.label} shift ${shift.range}. ${live}`,
  };
}
