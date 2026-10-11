import { beforeEach, afterEach, expect, it, vi } from 'vitest';
vi.mock('../src/services/nicheProviders', async original => ({ ...await original<typeof import('../src/services/nicheProviders')>(), whatsappCredential: vi.fn() }));
import { whatsappCredential } from '../src/services/nicheProviders';
import { sendStoreReport, verifyReportTemplate, reportTemplateParameters } from '../src/services/storeReportDelivery';
import type { StoreReport } from '../src/services/storeReportService';
const template = { name: 'daily_store', language: 'en_US', status: 'APPROVED', category: 'UTILITY', components: [{ type: 'BODY', text: 'Report {{1}} Orders {{2}} Units {{3}} Order value {{4}} Paid order value {{5}} Unfulfilled {{6}} Products {{7}}' }] };
const report = { period: 'Yesterday', orders: 2, units: 3, unfulfilledOrders: 1, totals: [{ currency: 'PKR', orderValue: '100.00', paidOrderValue: '50.00' }], topProducts: [{ title: 'Tee\nblue', units: 3 }] } as StoreReport;
beforeEach(() => { vi.resetAllMocks(); vi.mocked(whatsappCredential).mockResolvedValue({ accessToken: 'fixture', phoneNumberId: '12345', wabaId: '54321' }); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [template] })))); });
afterEach(() => vi.unstubAllGlobals());
it('verifies an approved utility template against the tenant account', async () => { await verifyReportTemplate('tenant-a', 'daily_store', 'en_US'); expect(whatsappCredential).toHaveBeenCalledWith('tenant-a'); expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain('/54321/message_templates'); });
it.each([{ ...template, status: 'PENDING' }, { ...template, category: 'MARKETING' }, { ...template, components: [{ type: 'BODY', text: '{{1}}' }] }, { ...template, language: 'fr' }])('rejects unusable report templates', async item => {
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ data: [item] }))); await expect(verifyReportTemplate('a', 'daily_store', 'en_US')).rejects.toThrow('approved UTILITY');
});
it('sends exactly six safe parameters and returns acceptance, not delivery', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: 'wamid.report' }] })));
  expect(await sendStoreReport('a', '+923001234567', 'daily_store', 'en_US', report)).toBe('wamid.report');
  const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string); expect(body.to).toBe('923001234567'); expect(body.type).toBe('template'); expect(body.template.components[0].parameters).toHaveLength(7); expect(reportTemplateParameters(report)[4]).toBe('50.00 PKR'); expect(reportTemplateParameters(report)[6]).toBe('Tee blue: 3');
});
it.each([500, 502])('marks provider %s responses as uncertain so the worker will not resend', async status => {
  vi.mocked(fetch).mockResolvedValue(new Response('error', { status })); await expect(sendStoreReport('a', '+923001234567', 'daily_store', 'en_US', report)).rejects.toMatchObject({ uncertain: true });
});
it('distinguishes explicit rejection and an invalid success response', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response('error', { status: 400 })).mockResolvedValueOnce(new Response('{}'));
  await expect(sendStoreReport('a', '+923001234567', 'daily_store', 'en_US', report)).rejects.toMatchObject({ uncertain: false });
  await expect(sendStoreReport('a', '+923001234567', 'daily_store', 'en_US', report)).rejects.toMatchObject({ uncertain: true });
});
