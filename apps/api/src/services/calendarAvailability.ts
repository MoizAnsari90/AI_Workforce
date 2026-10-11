import type { BusinessProfileInput } from './businessProfileService';

// Convert wall-clock components to UTC using the zone's actual offset on this date.
// A failed round-trip rejects DST gaps rather than silently moving a booking.
export function wallTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timezone: string) {
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  let result = desired;
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  for (let i = 0; i < 4; i++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(result)).map(part => [part.type, part.value]));
    const actual = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
    if (actual === desired) return new Date(result);
    result += desired - actual;
  }
  throw new Error('This local time does not exist because of a clock change. Choose another time.');
}

export function dateBounds(date: string, timezone: string) {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return { start: wallTimeToUtc(y, m, d, 0, 0, timezone), end: wallTimeToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, timezone) };
}

export function availableSlots(date: string, profile: BusinessProfileInput, busy: { start: string; end: string }[], now = new Date()) {
  const [year, month, day] = date.split('-').map(Number);
  const schedule = profile.workingHours.find(item => item.day === new Date(Date.UTC(year, month - 1, day)).getUTCDay());
  if (!schedule?.enabled) return [];
  const minutes = (value: string) => { const [h, m] = value.split(':').map(Number); return h * 60 + m; };
  const result: { start: string; end: string }[] = [];
  const buffer = profile.bufferMinutes * 60_000;
  for (let offset = minutes(schedule.start); offset + profile.slotMinutes <= minutes(schedule.end); offset += profile.slotMinutes + profile.bufferMinutes) {
    try {
      const start = wallTimeToUtc(year, month, day, Math.floor(offset / 60), offset % 60, profile.timezone);
      const endOffset = offset + profile.slotMinutes;
      const end = wallTimeToUtc(year, month, day, Math.floor(endOffset / 60), endOffset % 60, profile.timezone);
      // Do not offer a slot spanning a DST change or a nonexistent wall time.
      if (end.getTime() - start.getTime() !== profile.slotMinutes * 60_000 || start <= now) continue;
      if (busy.some(item => start.getTime() < Date.parse(item.end) + buffer && end.getTime() > Date.parse(item.start) - buffer)) continue;
      result.push({ start: start.toISOString(), end: end.toISOString() });
    } catch { /* A DST gap is unavailable, never an invented slot. */ }
  }
  return result;
}
