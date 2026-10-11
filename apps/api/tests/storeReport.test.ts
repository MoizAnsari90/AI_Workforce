import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), forTenant: vi.fn(), verify: vi.fn(), credential: vi.fn(), profile: vi.fn() }));
vi.mock('../src/services/shopifyClient', () => ({ ShopifyClient: { forTenant: mocks.forTenant } }));
vi.mock('../src/services/integrationService', () => ({ IntegrationService: { getCredential: mocks.credential } }));
vi.mock('../src/services/businessProfileService', () => ({ getBusinessProfile: mocks.profile }));
import { generateStoreReport, decimalText, decimalUnits } from '../src/services/storeReportService';
const now = new Date('2026-10-11T10:00:00Z');
const pageInfo = { hasNextPage: false, endCursor: null };
const order = (id: string, amount = '0.10', currencyCode = 'USD') => ({ id, createdAt: '2026-10-10T05:00:00.000Z', test: false, cancelledAt: null, displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'UNFULFILLED', currentTotalPriceSet: { shopMoney: { amount, currencyCode } }, lineItems: { nodes: [{ id: `line-${id}`, title: 'Tee', currentQuantity: 2 }], pageInfo: { hasNextPage: false } } });
const response = (nodes = [order('1')], more = false, cursor: string | null = null) => ({ orders: { nodes, pageInfo: { hasNextPage: more, endCursor: cursor } } });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.profile.mockResolvedValue({ profile: { timezone: 'Asia/Karachi' } });
  mocks.credential.mockResolvedValue(null);
  mocks.forTenant.mockResolvedValue({ query: mocks.query, verifyConnection: mocks.verify });
  mocks.verify.mockResolvedValue({ currentAppInstallation: { accessScopes: [{ handle: 'read_orders' }] } });
  mocks.query.mockResolvedValue(response());
});
afterEach(() => vi.useRealTimers());
it('counts all pages, excludes cancelled/test orders and keeps money exact and currencies separate', async () => {
  mocks.query.mockResolvedValueOnce(response([order('1'), { ...order('test'), test: true }], true, 'page2')).mockResolvedValueOnce(response([order('2', '0.20'), { ...order('3', '100', 'PKR'), displayFinancialStatus: 'PENDING', displayFulfillmentStatus: 'FULFILLED' }, { ...order('cancel'), cancelledAt: '2026-10-10T06:00:00Z' }]));
  const report = await generateStoreReport('tenant-a', 'yesterday', now);
  expect(report).toMatchObject({ orders: 3, units: 6, paidOrders: 2, unpaidOrders: 1, unfulfilledOrders: 2, cancelledOrders: 1, testOrdersExcluded: 1, topProducts: [{ title: 'Tee', units: 6 }], totals: [{ currency: 'PKR', orderValue: '100.00', paidOrderValue: '0.00' }, { currency: 'USD', orderValue: '0.30', paidOrderValue: '0.30' }] });
  expect(report.start).toBe('2026-10-09T19:00:00.000Z'); expect(report.end).toBe('2026-10-10T19:00:00.000Z');
  expect(mocks.forTenant).toHaveBeenCalledWith('tenant-a'); expect(mocks.query.mock.calls[1][1].after).toBe('page2');
});
it('distinguishes an empty verified period from failed provider access', async () => {
  mocks.query.mockResolvedValue(response([])); expect(await generateStoreReport('a', 'yesterday', now)).toMatchObject({ orders: 0, units: 0, totals: [] });
  mocks.query.mockRejectedValue(new Error('secret-provider-token')); await expect(generateStoreReport('a', 'yesterday', now)).rejects.toThrow('could not be verified');
});
it.each(['today and yesterday', 'tomorrow', '2026-02-31', '2027-01-01', 'between 2026-10-01 and 2026-10-05', 'all time'])('rejects ambiguous, missing or invalid periods: %s', async period => {
  await expect(generateStoreReport('a', period, now)).rejects.toThrow(); expect(mocks.query).not.toHaveBeenCalled();
});
it('does not approximate missing order lines', async () => {
  const item = order('1'); item.lineItems.pageInfo.hasNextPage = true; mocks.query.mockResolvedValue(response([item]));
  await expect(generateStoreReport('a', 'yesterday', now)).rejects.toThrow('100 line items');
});
it('rejects duplicate pages and out-of-period provider records', async () => {
  mocks.query.mockResolvedValue(response([order('1')], true, 'same'));
  await expect(generateStoreReport('a', 'yesterday', now)).rejects.toThrow('could not be verified');
  mocks.query.mockResolvedValue(response([{ ...order('1'), createdAt: now.toISOString() }]));
  await expect(generateStoreReport('a', 'yesterday', now)).rejects.toThrow('could not be verified');
});
it('rejects incomplete large reports instead of showing a partial total', async () => {
  let page = 0; mocks.query.mockImplementation(async () => response([order(String(++page))], true, String(page)));
  await expect(generateStoreReport('a', 'yesterday', now)).rejects.toThrow('2,000');
});
it('checks scopes and history before requesting order data', async () => {
  mocks.verify.mockResolvedValue({ currentAppInstallation: { accessScopes: [] } });
  await expect(generateStoreReport('a', 'yesterday', now)).rejects.toThrow('read permission');
  mocks.verify.mockResolvedValue({ currentAppInstallation: { accessScopes: [{ handle: 'read_orders' }] } });
  await expect(generateStoreReport('a', '2025-01-01', now)).rejects.toThrow('history'); expect(mocks.query).not.toHaveBeenCalled();
});
it('uses calendar-day boundaries across DST instead of assuming 24 hours', async () => {
  mocks.query.mockResolvedValue(response([]));
  const report = await generateStoreReport('a', '2026-11-01', new Date('2026-11-02T12:00:00Z'), 'America/New_York');
  expect(Date.parse(report.end) - Date.parse(report.start)).toBe(25 * 3600000);
});
it('does not use floating point for money', () => {
  expect(decimalText(decimalUnits('999999999999999.99') + decimalUnits('0.01'))).toBe('1000000000000000.00');
  expect(decimalText(decimalUnits('-0.001'))).toBe('-0.001');
  expect(() => decimalUnits('1e3')).toThrow();
});
