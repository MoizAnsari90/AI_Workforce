export interface WorkforcePeriod { start: Date; end: Date; label: string }
const zone = 'Asia/Karachi';
const dayMs = 86_400_000;

export function requestsSpecificPeriod(question: string) {
  return /\b(today|yesterday|aaj|aj|kal|pichl[aei]\s+din)\b|\b(?:last|past)\s+7\s+days?\b|\bthis\s+(?:week|month)\b|\blast\s+(?:week|month)\b|\b\d{4}-\d{1,2}-\d{1,2}\b|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d|\b\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\b/i.test(question);
}

function localDate(now: Date) {
  const fields = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now).reduce<Record<string, string>>((all, part) => { all[part.type] = part.value; return all; }, {});
  return { year: Number(fields.year), month: Number(fields.month), day: Number(fields.day) };
}

function localMidnight(year: number, month: number, day: number) {
  // Asia/Karachi has a stable UTC+05:00 offset (no daylight-saving transitions).
  return new Date(Date.UTC(year, month - 1, day) - 5 * 60 * 60 * 1000);
}

function labelFor(start: Date, end: Date, now: Date, kind: 'day' | 'range' | 'instant') {
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: zone, day: 'numeric', month: 'short', year: 'numeric' });
  if (kind === 'instant') return 'the past 7 days (through ' + fmt.format(now) + '; ' + zone + ')';
  return kind === 'day' ? fmt.format(start) + ' (' + zone + ')' : fmt.format(start) + ' to ' + fmt.format(new Date(end.getTime() - 1)) + ' (' + zone + ')';
}

export function parseWorkforcePeriod(question: string, now = new Date()): WorkforcePeriod | null {
  const q = question.toLowerCase();
  const { year, month, day } = localDate(now);
  const today = new Date(Date.UTC(year, month - 1, day));
  let firstDay: Date | null = null;
  let endDay: Date | null = null;
  let instant = false;
  if (/\b(today|aaj|aj)\b/.test(q)) firstDay = today;
  else if (/\b(yesterday|kal|pichl[aei]\s+din)\b/.test(q)) firstDay = new Date(today.getTime() - dayMs);
  else if (/\b(last|past)\s+7\s+days?\b/.test(q) || /\bpichhl[aei]\s+7\s+din\b/.test(q)) instant = true;
  else if (/\bthis\s+week\b/.test(q) || /\bis\s+haft[ae]\b/.test(q)) {
    const weekday = new Date(today).getUTCDay();
    firstDay = new Date(today.getTime() - ((weekday + 6) % 7) * dayMs);
    endDay = new Date(firstDay.getTime() + 7 * dayMs);
  } else if (/\blast\s+week\b/.test(q) || /\bpichhl[aei]\s+haft[ae]\b/.test(q)) {
    const weekday = new Date(today).getUTCDay();
    endDay = new Date(today.getTime() - ((weekday + 6) % 7) * dayMs);
    firstDay = new Date(endDay.getTime() - 7 * dayMs);
  } else if (/\bthis\s+month\b/.test(q) || /\bis\s+mahin[ae]\b/.test(q)) {
    firstDay = new Date(Date.UTC(year, month - 1, 1));
    endDay = new Date(Date.UTC(year, month, 1));
  }
  else if (/\blast\s+month\b/.test(q) || /\bpichhl[aei]\s+mahin[ae]\b/.test(q)) {
    firstDay = new Date(Date.UTC(year, month - 2, 1));
    endDay = new Date(Date.UTC(year, month - 1, 1));
  } else {
    const iso = q.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
    const numeric = q.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
    const named = q.match(/\b(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b|\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(\d{4})\b/);
    const monthNumber = (name: string) => ['january','february','march','april','may','june','july','august','september','october','november','december'].indexOf(name) + 1;
    let y = 0, m = 0, d = 0;
    if (iso) { y = Number(iso[1]); m = Number(iso[2]); d = Number(iso[3]); }
    else if (numeric) { d = Number(numeric[1]); m = Number(numeric[2]); y = Number(numeric[3]); }
    else if (named?.[1]) { d = Number(named[1]); m = monthNumber(named[2]); y = Number(named[3]); }
    else if (named?.[4]) { m = monthNumber(named[4]); d = Number(named[5]); y = Number(named[6]); }
    if (y && m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate()) firstDay = new Date(Date.UTC(y, m - 1, d));
  }
  if (instant) {
    const end = now;
    return { start: new Date(end.getTime() - 7 * dayMs), end, label: labelFor(new Date(end.getTime() - 7 * dayMs), end, now, 'instant') };
  }
  if (!firstDay) return null;
  if (!endDay) endDay = new Date(firstDay.getTime() + dayMs);
  const start = localMidnight(firstDay.getUTCFullYear(), firstDay.getUTCMonth() + 1, firstDay.getUTCDate());
  const end = localMidnight(endDay.getUTCFullYear(), endDay.getUTCMonth() + 1, endDay.getUTCDate());
  return { start, end, label: labelFor(start, end, now, end.getTime() - start.getTime() === dayMs ? 'day' : 'range') };
}
