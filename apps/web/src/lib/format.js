/** Stored numbers are digits only. Indian and North American numbers get familiar spacing. */
export function formatPhone(digits) {
  if (!digits) return '';
  const d = String(digits);
  if (d.length === 12 && d.startsWith('91')) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  if (d.length === 11 && d.startsWith('1')) return `+1 ${d.slice(1, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
  return `+${d}`;
}

/** Best label for a contact: saved name, then number, then WhatsApp username. */
export function contactLabel(contact) {
  if (!contact) return 'Unknown';
  return contact.name || formatPhone(contact.phone) || contact.waUsername || 'Unknown';
}

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function formatTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Compact time for lists: "3:42 PM" today, "Yesterday", then "12 Nov". */
export function formatListTime(value) {
  if (!value) return '';
  const date = new Date(value);
  const now = new Date();
  if (sameDay(date, now)) return formatTime(date);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return 'Yesterday';
  return date.toLocaleDateString([], {
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

/** Heading between days in a thread. */
export function formatDayHeading(value) {
  const date = new Date(value);
  const now = new Date();
  if (sameDay(date, now)) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return 'Yesterday';
  return date.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

export const dayKey = (value) => {
  const d = new Date(value);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

export function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** "5h 12m" / "42m" / "under a minute" */
export function formatDuration(ms) {
  if (ms <= 0) return '0m';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'under a minute';
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

export const percent = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);

export const plural = (count, one, many = `${one}s`) => `${Number(count).toLocaleString()} ${count === 1 ? one : many}`;
