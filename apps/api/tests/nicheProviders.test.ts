import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/services/integrationService', () => ({ IntegrationService: { getCredential: vi.fn(), storeCredential: vi.fn() } }));
import { IntegrationService } from '../src/services/integrationService';
import { connectNicheVoice, DispatchError, sendNicheVoiceCall, sendNicheWhatsApp, verifyNicheVoiceRequest, verifyReminderTemplate } from '../src/services/nicheProviders';
import { defaultAutomation } from '../src/services/nicheAutomationStore';
const assistantId = 'b5b550df-33bd-4d6d-98e1-c52028873c61', phoneNumberId = 'd101d222-e181-466a-a4c3-5b75c30eae10', callId = '688c222c-736e-40b9-a38a-cc8f57a5873b';
const voice = { apiKey: 'fixture-private-key', assistantId, phoneNumberId, webhookSecret: 'fixture-bearer-secret-at-least-32-characters' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const originalOrigin = process.env.PUBLIC_API_URL;
beforeEach(() => { vi.clearAllMocks(); process.env.PUBLIC_API_URL = 'https://api.example.test'; vi.mocked(IntegrationService.getCredential).mockImplementation(async (_tenantId, provider) => provider === 'vapi' ? voice : { accessToken: 'tenant-token', phoneNumberId: '12345678', wabaId: '87654321' }); });
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
  it('distinguishes explicit rejection from uncertain delivery', async () => {
    const fetch = vi.fn().mockResolvedValue(reply({}, 400)); vi.stubGlobal('fetch', fetch); await expect(sendNicheWhatsApp('t', '+923001234567', { text: 'Hello' })).rejects.toMatchObject({ uncertain: false });
    fetch.mockRejectedValue(new Error('timeout')); await expect(sendNicheWhatsApp('t', '+923001234567', { text: 'Hello' })).rejects.toBeInstanceOf(DispatchError);
    fetch.mockResolvedValue(reply({}, 503)); await expect(sendNicheWhatsApp('t', '+923001234567', { text: 'Hello' })).rejects.toMatchObject({ uncertain: true });
  });
  it('rejects wrong voice bearer authentication before fetching any call', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); expect(await verifyNicheVoiceRequest('tenant-a', 'Bearer forged', callId)).toBeNull(); expect(fetch).not.toHaveBeenCalled();
  });
  it('checks actual provider call ownership instead of trusting webhook phone/assistant fields', async () => {
    const fetch = vi.fn().mockResolvedValue(reply({ id: callId, assistantId, phoneNumberId, customer: { number: '+923001234567' } })); vi.stubGlobal('fetch', fetch);
    expect((await verifyNicheVoiceRequest('tenant-a', `Bearer ${voice.webhookSecret}`, callId))?.customer.number).toBe('+923001234567');
    fetch.mockResolvedValue(reply({ id: callId, assistantId: 'foreign', phoneNumberId, customer: { number: '+923001234567' } })); expect(await verifyNicheVoiceRequest('tenant-a', `Bearer ${voice.webhookSecret}`, callId)).toBeNull();
  });
  it('saves voice credentials only after verifying the bound phone, assistant and authenticated server URL', async () => {
    const server = { url: 'https://api.example.test/api/v1/webhook/tenant-a/niche-voice', credentialId: 'saved-credential' };
    let toolEnabled = true;
    const fetch = vi.fn().mockImplementation(async (url: string) => reply(url.includes('/assistant/') ? { id: assistantId, server, model: { toolIds: [callId] } } : url.includes('/tool/') ? { type: 'function', async: !toolEnabled, function: { name: 'workforce_turn', parameters: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } } }, server } : { id: phoneNumberId, assistantId })); vi.stubGlobal('fetch', fetch);
    expect((await connectNicheVoice('tenant-a', 'admin', voice)).connected).toBe(true); expect(IntegrationService.storeCredential).toHaveBeenCalledTimes(1);
    toolEnabled = false; await expect(connectNicheVoice('tenant-a', 'admin', voice)).rejects.toThrow('synchronous workforce_turn'); expect(IntegrationService.storeCredential).toHaveBeenCalledTimes(1);
    fetch.mockResolvedValue(reply({ id: assistantId, server: { url: 'https://foreign.test' } })); await expect(connectNicheVoice('tenant-a', 'admin', voice)).rejects.toThrow(); expect(IntegrationService.storeCredential).toHaveBeenCalledTimes(1);
  });
  it('starts calls using a saved assistant and never embeds a transient untrusted server configuration', async () => {
    const fetch = vi.fn().mockResolvedValue(reply({ id: callId })); vi.stubGlobal('fetch', fetch); expect(await sendNicheVoiceCall('tenant-a', '+923001234567', 'dispatch-ref')).toBe(callId);
    const body = JSON.parse(fetch.mock.calls[0][1].body); expect(body).toMatchObject({ assistantId, phoneNumberId, metadata: { workforceDispatch: 'dispatch-ref' } }); expect(body.assistant).toBeUndefined(); expect(body.assistantOverrides).toBeUndefined();
  });
});
