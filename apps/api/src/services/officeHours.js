/**
 * Office hours: seven days, Sunday first, each either closed or open between
 * two "HH:MM" times in the workspace's time zone. A day whose end is earlier
 * than its start runs past midnight (e.g. 20:00–02:00).
 */

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

export const DEFAULT_DAYS = [
  { open: false, start: '10:00', end: '19:00' }, // Sunday
  { open: true, start: '10:00', end: '19:00' },
  { open: true, start: '10:00', end: '19:00' },
  { open: true, start: '10:00', end: '19:00' },
  { open: true, start: '10:00', end: '19:00' },
  { open: true, start: '10:00', end: '19:00' },
  { open: true, start: '10:00', end: '14:00' }, // Saturday
];

export const DEFAULT_AWAY_MESSAGE =
  'Thank you for your message. Our office is closed right now. We will reply as soon as we are back during working hours.';

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function isValidTimezone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/** "HH:MM" → minutes after midnight, or null when malformed. */
export function toMinutes(value) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value ?? ''));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** Day of week (0 = Sunday) and minutes after midnight at `date` in `timeZone`. */
export function localClock(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return { day: WEEKDAYS[get('weekday')], minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute')) };
}

/** True when `date` falls inside the opening hours. */
export function isOpenAt(days, date, timeZone) {
  if (!Array.isArray(days) || days.length !== 7) return true;
  const { day, minutes } = localClock(date, timeZone);

  const today = days[day];
  if (today?.open) {
    const start = toMinutes(today.start);
    const end = toMinutes(today.end);
    if (start !== null && end !== null) {
      if (end > start && minutes >= start && minutes < end) return true;
      if (end < start && minutes >= start) return true; // runs past midnight
    }
  }

  // Yesterday's hours may run past midnight into today.
  const yesterday = days[(day + 6) % 7];
  if (yesterday?.open) {
    const start = toMinutes(yesterday.start);
    const end = toMinutes(yesterday.end);
    if (start !== null && end !== null && end < start && minutes < end) return true;
  }
  return false;
}
