import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/prisma', () => ({ prisma: { googleCalendarConnection: { findUnique: vi.fn() } } }));
import { prisma } from '../src/lib/prisma';
import { encryptCalendarTokens, syncAppointmentEvent } from '../src/services/googleCalendarService';

const booking = { id: 'appointment-fixture', tenantId: 'workspace-fixture', calendarId: 'calendar@example.test', connectionId: 'connection-fixture', eventId: 'abc123def456', startTime: new Date('2030-01-07T04:00:00Z'), endTime: new Date('2030-01-07T04:30:00Z'), timezone: 'Asia/Karachi' };
const event = { id: booking.eventId, status: 'confirmed', start: { dateTime: booking.startTime.toISOString() }, end: { dateTime: booking.endTime.toISOString() }, extendedProperties: { private: { workforceBooking: booking.id } } };
const reply = (body: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status });
function connection(scope = 'https://www.googleapis.com/auth/calendar.events', connectionId = booking.connectionId) {
  vi.mocked(prisma.googleCalendarConnection.findUnique).mockResolvedValue({ tenantId: booking.tenantId, connectionId, encryptedTokens: encryptCalendarTokens({ accessToken: 'fixture-token', refreshToken: 'fixture-refresh', expiresAt: Date.now() + 3600000, scope }), calendarId: booking.calendarId, calendarName: 'Fixture', calendarTimezone: 'Asia/Karachi', connectedAt: new Date(), updatedAt: new Date() });
}
beforeEach(() => { vi.clearAllMocks(); connection(); });
afterEach(() => vi.unstubAllGlobals());
describe('Appointment Google event protocol', () => {
  it('creates a deterministic private event without customer information or attendees', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(reply({}, 404)).mockResolvedValueOnce(reply(event)); vi.stubGlobal('fetch', fetch);
    expect(await syncAppointmentEvent(booking)).toBe('confirmed');
    const body = JSON.parse(fetch.mock.calls[1][1].body); expect(body.id).toBe(booking.eventId); expect(body.summary).toBe('Reserved appointment'); expect(body.visibility).toBe('private'); expect(body.attendees).toBeUndefined(); expect(body.description).toBeUndefined(); expect(body.reminders).toEqual({ useDefault: false });
    expect(fetch.mock.calls[0][0]).toContain('calendar%40example.test');
  });
  it('reads an existing event before retrying insertion and never creates a duplicate', async () => {
    const fetch = vi.fn().mockResolvedValue(reply(event)); vi.stubGlobal('fetch', fetch);
    expect(await syncAppointmentEvent(booking)).toBe('confirmed'); expect(fetch).toHaveBeenCalledTimes(1); expect(fetch.mock.calls[0][1].method).toBe('GET');
  });
  it('resolves insert conflict through GET and verifies event ownership and times', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(reply({}, 404)).mockResolvedValueOnce(reply({}, 409)).mockResolvedValueOnce(reply(event)); vi.stubGlobal('fetch', fetch);
    expect(await syncAppointmentEvent(booking)).toBe('confirmed'); expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('keeps provider timeout uncertain so the caller preserves the reservation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(reply({}, 404)).mockRejectedValueOnce(new Error('network timeout')));
    await expect(syncAppointmentEvent(booking)).rejects.toThrow('confirmation is pending');
  });
  it('never confirms or deletes an externally modified or foreign event', async () => {
    const fetch = vi.fn().mockResolvedValue(reply({ ...event, start: { dateTime: '2030-01-07T06:00:00Z' } })); vi.stubGlobal('fetch', fetch);
    expect(await syncAppointmentEvent(booking, true)).toBe('review_required'); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('confirms cancellation only after deletion and disables automatic reminders', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(reply(event)).mockResolvedValueOnce(reply(null, 204)); vi.stubGlobal('fetch', fetch);
    expect(await syncAppointmentEvent(booking, true)).toBe('cancelled'); expect(fetch.mock.calls[1][1].method).toBe('DELETE');
  });
  it('does not release a cancellation if the provider rejects deletion', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(reply(event)).mockResolvedValueOnce(reply({}, 403)));
    await expect(syncAppointmentEvent(booking, true)).rejects.toThrow('Cancellation is pending');
  });
  it('establishes and deletes a deterministic event when cancelling an uncertain insert', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(reply({}, 404)).mockResolvedValueOnce(reply(event)).mockResolvedValueOnce(reply(null, 204)); vi.stubGlobal('fetch', fetch);
    expect(await syncAppointmentEvent(booking, true)).toBe('cancelled'); expect(fetch.mock.calls.map(call => call[1].method)).toEqual(['GET', 'POST', 'DELETE']);
  });
  it('reconciles a deleted event without recreating it', async () => {
    const fetch = vi.fn().mockResolvedValue(reply({}, 410)); vi.stubGlobal('fetch', fetch);
    expect(await syncAppointmentEvent(booking)).toBe('cancelled'); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('allows verified existing appointments after reconnect but cannot recreate a missing event on a new connection', async () => {
    connection(undefined, 'new-connection'); const fetch = vi.fn().mockResolvedValueOnce(reply(event)).mockResolvedValueOnce(reply({}, 404)); vi.stubGlobal('fetch', fetch);
    expect(await syncAppointmentEvent(booking)).toBe('confirmed'); await expect(syncAppointmentEvent(booking)).rejects.toThrow('not visible after reconnecting'); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('requires write consent and fails closed on malformed provider output', async () => {
    connection('https://www.googleapis.com/auth/calendar.events.freebusy'); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(syncAppointmentEvent(booking)).rejects.toThrow('appointment permissions'); expect(fetch).not.toHaveBeenCalled();
    connection(); fetch.mockResolvedValue(reply({ id: 'wrong-event' })); await expect(syncAppointmentEvent(booking)).rejects.toThrow('invalid appointment');
  });
});
