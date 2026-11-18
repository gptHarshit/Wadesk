/** Formatting for the campaign report CSV. Pure functions, no database. */

export const REPORT_STATUS = { pending: 'Waiting', sent: 'Sent', delivered: 'Delivered', read: 'Read', failed: 'Failed', skipped: 'Skipped' };

/** One CSV cell. Text that a spreadsheet would run as a formula gets a leading apostrophe. */
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Digits with spaces and no plus sign, so spreadsheets keep it as text instead of 9.19E+11. */
export function reportPhone(digits) {
  if (!digits) return '';
  const d = String(digits);
  if (d.length === 12 && d.startsWith('91')) return `91 ${d.slice(2, 7)} ${d.slice(7)}`;
  return d.length > 10 ? `${d.slice(0, -10)} ${d.slice(-10)}` : d;
}

/** "2026-11-18 16:05" in the given time zone. */
export function reportTime(value, timeZone) {
  if (!value) return '';
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(value))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}
