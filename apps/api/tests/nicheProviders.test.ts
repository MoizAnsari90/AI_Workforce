import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/services/integrationService', () => ({ IntegrationService: { getCredential: vi.fn(), storeCredential: vi.fn() } }));
import { IntegrationService } from '../src/services/integrationService';
import { DispatchError, sendNicheWhatsApp, verifyReminderTemplate } from '../src/services/nicheProviders';
import { connectDograh, getDograhCredential, sendDograhCall, verifyDograhWebhookSecret } from '../src/services/dograh';
import { defaultAutomation } from '../src/services/nicheAutomationStore';
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const secret = 'fixture-dograh-webhook-secret-at-least-32-characters';
const dograh = { apiUrl: 'https://dograh.example.test', apiKey: 'dg_fixture_api_key', agentId: 'agent-fixture', webhookSecret: secret };
const originalOrigin = process.env.PUBLIC_API_URL;
beforeEach(() => {
  vi.clearAllMocks(); process.env.PUBLIC_API_URL = 'https://api.example.test';
  vi.mocked(IntegrationService.getCredential).mockImplementation(async (_tenantId, provider) => provider === 'dograh' ? dograh : { accessToken: 'tenant-token', phoneNumberId: '12345678', wabaId: '87654321' });
});
afterEach(() => { vi.unstubAllGlobals(); if (originalOrigin === undefined) delete process.env.PUBLIC_API_URL; else process.env.PUBLIC_API_URL = originalOrigin; });

describe('Niche provider boundaries', () => {
  it('uses only workspace WhatsApp credentials and verifies acceptance IDs', async () => {
    const fetch = vi.fn().mockResolvedValue(reply({ messages: [{ id: 'wamid.real-fixture' }] })); vi.stubGlobal('fetch', fetch);
    expect(await sendNicheWhatsApp('tenant-a', '+923001234567', { text: 'Hello' })).toBe('wamid.real-fixture'); expect(IntegrationService.getCredential).toHaveBeenCalledWith('tenant-a', 'whatsapp'); expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer tenant-token'); expect(JSON.parse(fetch.mock.calls[0][1].body).to).toBe('923001234567');
    fetch.mockResolvedValue(reply({})); await expect(sendNicheWhatsApp('tenant-a', '+923001234567', { text: 'Hello' })).rejects.toMatchObject({ uncertain: true });
  });
  it('cannot fall back to global WhatsApp credentials or a mock success', async () => {
    vi.mocked(IntegrationService.getCredential).mockResolvedValue(null); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(sendNicheWhatsApp('tenant-a', '+923001234567', { text: 'Hello' })).rejects.toThrow('Connect this workspace'); expect(fetch).not.toHaveBeenCalled();
  });
  it('accepts only an approved utility template with the expected single date parameter', async () => {
    const template = { name: 'appointment_reminder', language: 'en_US', category: 'UTILITY', status: 'APPROVED', components: [{ type: 'BODY', text: 'Appointment reminder: {{1}}.' }] };
    const fetch = vi.fn().mockResolvedValue(reply({ data: [template] })); vi.stubGlobal('fetch', fetch); const config = { ...defaultAutomation, templateName: template.name };
    expect((await verifyReminderTemplate('tenant-a', config)).name).toBe(template.name);
    for (const changed of [{ ...template, status: 'PAUSED' }, { ...template, category: 'MARKETING' }, { ...template, components: [{ type: 'BODY', text: '{{1}} and {{2}}' }] }]) { fetch.mockResolvedValue(reply({ data: [changed] })); await expect(verifyReminderTemplate('tenant-a', config)).rejects.toThrow('approved UTILITY'); }
  });
  it('stores the Dograh connection per tenant and returns the public callback URL', async () => {
    expect(await connectDograh('tenant-a', 'user-a', dograh)).toEqual({ connected: true, webhookUrl: 'https://api.example.test/api/webhooks/dograh/tenant-a' });
    expect(IntegrationService.storeCredential).toHaveBeenCalledWith({ tenantId: 'tenant-a', userId: 'user-a', provider: 'dograh', config: dograh });
    expect(await getDograhCredential('tenant-a')).toMatchObject(dograh);
  });
  it('triggers the published Dograh agent and persists its workflow run ID contract', async () => {
    const fetch = vi.fn().mockResolvedValue(reply({ status: 'initiated', workflow_run_id: 4312 })); vi.stubGlobal('fetch', fetch);
    expect(await sendDograhCall('tenant-a', '+923001234567', 'dispatch-1')).toBe('4312');
    expect(fetch.mock.calls[0][0]).toBe('https://dograh.example.test/api/v1/public/agent/workflow/agent-fixture');
    expect(fetch.mock.calls[0][1].headers['X-API-Key']).toBe(dograh.apiKey);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ phone_number: '+923001234567', initial_context: { tenant_id: 'tenant-a', workforce_dispatch_id: 'dispatch-1' } });
    fetch.mockResolvedValue(reply({}, 503)); await expect(sendDograhCall('tenant-a', '+923001234567', 'dispatch-2')).rejects.toMatchObject({ uncertain: true });
    fetch.mockResolvedValue(reply({ status: 'initiated' })); await expect(sendDograhCall('tenant-a', '+923001234567', 'dispatch-3')).rejects.toMatchObject({ uncertain: true });
    fetch.mockRejectedValue(new Error('timeout')); await expect(sendDograhCall('tenant-a', '+923001234567', 'dispatch-4')).rejects.toBeInstanceOf(DispatchError);
  });
  it('uses constant-time bearer secret matching and rejects forged callbacks', () => {
    expect(verifyDograhWebhookSecret(secret, `Bearer ${secret}`)).toBe(true);
    expect(verifyDograhWebhookSecret(secret, 'Bearer forged')).toBe(false);
  });
});
