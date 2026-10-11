import { describe, expect, it } from 'vitest';
import { availableSlots, dateBounds, wallTimeToUtc } from '../src/services/calendarAvailability';
import { businessProfileSchema, type BusinessProfileInput } from '../src/services/businessProfileService';
import { parseWorkforcePeriod } from '../src/services/workforcePeriod';

const profile: BusinessProfileInput = {
  name: 'Test business', country: 'PK', industry: 'real_estate', currency: 'PKR', timezone: 'Asia/Karachi', languages: ['en'], primaryLanguage: 'en', slotMinutes: 30, bufferMinutes: 0,
  workingHours: Array.from({ length: 7 }, (_, day) => ({ day, enabled: true, start: '09:00', end: '11:00' })),
};
describe('Business hours and regional time', () => {
  it.each([['Asia/Karachi', '2030-01-07T04:00:00.000Z'], ['Asia/Dubai', '2030-01-07T05:00:00.000Z'], ['America/New_York', '2030-01-07T14:00:00.000Z']])('calculates working hours in %s', (timezone, expected) => {
    const slots = availableSlots('2030-01-07', { ...profile, timezone }, [], new Date('2030-01-01'));
    expect(slots).toHaveLength(4); expect(slots[0].start).toBe(expected);
  });
  it('excludes busy intervals, buffers and past slots', () => {
    const slots = availableSlots('2030-01-07', { ...profile, bufferMinutes: 10 }, [{ start: '2030-01-07T04:35:00Z', end: '2030-01-07T05:00:00Z' }], new Date('2030-01-01'));
    expect(slots).toEqual([{ start: '2030-01-07T05:20:00.000Z', end: '2030-01-07T05:50:00.000Z' }]);
    expect(availableSlots('2030-01-07', profile, [], new Date('2030-01-07T05:45:00Z'))).toEqual([]);
  });
  it('does not offer closed days', () => {
    expect(availableSlots('2030-01-07', { ...profile, workingHours: profile.workingHours.map(day => ({ ...day, enabled: false })) }, [])).toEqual([]);
  });
  it.each([['2026-03-08', 23], ['2026-11-01', 25]])('uses a %s local day of %s hours', (date, duration) => {
    const { start, end } = dateBounds(date, 'America/New_York'); expect((+end - +start) / 3_600_000).toBe(duration);
    const period = parseWorkforcePeriod(date, new Date('2026-10-03'), 'America/New_York')!;
    expect(period.start).toEqual(start); expect(period.end).toEqual(end); expect(period.label).not.toContain(' to ');
  });
  it('rejects nonexistent DST times and skips appointments spanning a clock change', () => {
    expect(() => wallTimeToUtc(2026, 3, 8, 2, 30, 'America/New_York')).toThrow();
    const slots = availableSlots('2026-03-08', { ...profile, timezone: 'America/New_York', workingHours: profile.workingHours.map(day => ({ ...day, start: '01:00', end: '04:00' })) }, [], new Date('2026-01-01'));
    expect(slots.map(slot => slot.start)).toEqual(['2026-03-08T06:00:00.000Z', '2026-03-08T07:00:00.000Z', '2026-03-08T07:30:00.000Z']);
  });
  it('rejects duplicate days, invalid hours, unknown timezones and conflicting language settings', () => {
    expect(businessProfileSchema.safeParse({ ...profile, workingHours: Array(7).fill(profile.workingHours[0]) }).success).toBe(false);
    expect(businessProfileSchema.safeParse({ ...profile, workingHours: profile.workingHours.map(day => ({ ...day, end: '08:00' })) }).success).toBe(false);
    expect(businessProfileSchema.safeParse({ ...profile, timezone: 'not/a-zone' }).success).toBe(false);
    expect(businessProfileSchema.safeParse({ ...profile, primaryLanguage: 'ar' }).success).toBe(false);
  });
  it('uses the selected zone when today differs between Pakistan and US', () => {
    const now = new Date('2026-10-03T02:00:00Z');
    expect(parseWorkforcePeriod('today', now, 'Asia/Karachi')!.label).toContain('3 Oct');
    expect(parseWorkforcePeriod('today', now, 'America/Los_Angeles')!.label).toContain('2 Oct');
  });
});
