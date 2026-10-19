import { serverNow } from './time.js';

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

export const formatTime = (value) => timeFormat.format(new Date(value));
export const formatDateTime = (value) => dateTimeFormat.format(new Date(value));
export const formatDate = (value) => dateFormat.format(new Date(value));

/** 4 -> "4 min", 80 -> "1 h 20 min", 1500 -> "1 d 1 h" */
export function formatDuration(totalMinutes) {
  const minutes = Math.max(0, Math.round(totalMinutes));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days} d ${restHours} h` : `${days} d`;
}

/**
 * Deadline in words, measured against the server's app clock.
 * tone: "late" (past), "soon" (within 30 min), "normal", or "none" (no deadline)
 */
export function describeDeadline(deadline, { isFinal = false } = {}) {
  if (!deadline) return { text: 'No deadline', tone: 'none' };
  const minutesLeft = (new Date(deadline).getTime() - serverNow().getTime()) / 60_000;
  if (isFinal) return { text: formatDateTime(deadline), tone: 'normal' };
  if (minutesLeft < 0) return { text: `${formatDuration(-minutesLeft)} late`, tone: 'late' };
  if (minutesLeft <= 30) return { text: `in ${formatDuration(minutesLeft)}`, tone: 'soon' };
  if (minutesLeft < 12 * 60) return { text: `in ${formatDuration(minutesLeft)}`, tone: 'normal' };
  return { text: formatDateTime(deadline), tone: 'normal' };
}

/** "9000000001" -> "90000 00001" */
export function formatMobile(mobile) {
  return /^\d{10}$/.test(mobile ?? '') ? `${mobile.slice(0, 5)} ${mobile.slice(5)}` : mobile ?? '';
}

/** Value for <input type="datetime-local"> (local time, no seconds). */
export function toLocalInputValue(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
