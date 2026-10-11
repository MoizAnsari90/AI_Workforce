import { z } from 'zod';
import { ShopifyClient } from './shopifyClient';
import { IntegrationService } from './integrationService';
import { getBusinessProfile } from './businessProfileService';
import { parseWorkforcePeriod } from './workforcePeriod';
import { ConflictError, ServiceUnavailableError, ValidationError } from '../errors/AppError';

export const decimalUnits = (value: string) => {
  if (!/^-?\d+(?:\.\d{1,6})?$/.test(value)) throw new Error('Invalid money');
  const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
  return BigInt(whole + fraction.padEnd(6, '0')) * (value.startsWith('-') ? -1n : 1n);
};
export const decimalText = (value: bigint) => {
  const digits = (value < 0n ? -value : value).toString().padStart(7, '0');
  return (value < 0n ? '-' : '') + digits.slice(0, -6) + '.' + digits.slice(-6).replace(/0+$/, '').padEnd(2, '0');
};
const money = z.object({ amount: z.string().regex(/^-?\d+(?:\.\d{1,6})?$/), currencyCode: z.string().regex(/^[A-Z]{3}$/) });
const orderSchema = z.object({
  id: z.string(), createdAt: z.string().datetime(), cancelledAt: z.string().nullable(), test: z.boolean(),
  displayFinancialStatus: z.string().nullable(), displayFulfillmentStatus: z.string(),
  currentTotalPriceSet: z.object({ shopMoney: money }),
  lineItems: z.object({ nodes: z.array(z.object({ id: z.string(), title: z.string(), currentQuantity: z.number().int().nonnegative() })), pageInfo: z.object({ hasNextPage: z.boolean() }) }),
});
export interface StoreReport {
  period: string; timezone: string; start: string; end: string; checkedAt: string;
  orders: number; units: number; paidOrders: number; unpaidOrders: number; unfulfilledOrders: number;
  cancelledOrders: number; testOrdersExcluded: number;
  totals: Array<{ currency: string; orderValue: string; paidOrderValue: string }>;
  topProducts: Array<{ title: string; units: number }>;
  definition: string;
}
export async function generateStoreReport(tenantId: string, periodText: string, now = new Date(), timezoneOverride?: string): Promise<StoreReport> {
  const periods = periodText.match(/\b(?:today|yesterday|tomorrow|aaj|aj|kal|pichl[aei]\s+din|(?:last|past)\s+7\s+days?|(?:this|last)\s+(?:week|month)|\d{4}-\d{1,2}-\d{1,2})\b/gi) || [];
  if (periods.length > 1 || /\b(compare|versus|vs|between|tomorrow)\b/i.test(periodText)) throw new ValidationError('Choose one reporting period at a time, such as yesterday or this month.');
  const { profile } = await getBusinessProfile(tenantId);
  const timezone = timezoneOverride || profile?.timezone || 'Asia/Karachi';
  const period = parseWorkforcePeriod(periodText, now, timezone);
  if (!period || period.start >= now || period.end.getTime() - period.start.getTime() > 32 * 86400000) throw new ValidationError('Choose a current or past reporting period of up to 31 days.');
  if (await IntegrationService.getCredential(tenantId, 'woocommerce')) throw new ConflictError('Daily sales reports currently need Shopify. WooCommerce stock lookups remain available.');
  const client = await ShopifyClient.forTenant(tenantId);
  const scopes = (await client.verifyConnection()).currentAppInstallation.accessScopes.map(item => item.handle);
  if (!scopes.includes('read_orders') && !scopes.includes('write_orders')) throw new ConflictError('Reconnect Shopify with order read permission before requesting reports.');
  if (!scopes.includes('read_all_orders') && period.start.getTime() < now.getTime() - 60 * 86400000) throw new ValidationError('The requested date is outside the connected store\'s order history.');
  const end = new Date(Math.min(now.getTime(), period.end.getTime()));
  const report: StoreReport = { period: period.label, timezone, start: period.start.toISOString(), end: end.toISOString(), checkedAt: now.toISOString(), orders: 0, units: 0, paidOrders: 0, unpaidOrders: 0, unfulfilledOrders: 0, cancelledOrders: 0, testOrdersExcluded: 0, totals: [], topProducts: [], definition: 'Current values of non-test, non-cancelled orders created in this period, including unpaid orders. Units reflect current line quantities. Paid-order values are not payment receipts. This is not accounting net sales or profit; later refunds and edits may change these figures.' };
  const currencies = new Map<string, { total: bigint; paid: bigint }>();
  const products = new Map<string, { title: string; units: number }>();
  const seen = new Set<string>(), cursors = new Set<string>();
  let after: string | null = null;
  try {
    for (let page = 0; page < 20; page++) {
      const raw: unknown = await client.query(`query StoreDailyReport($query: String!, $after: String) {
        orders(first: 100, after: $after, query: $query, sortKey: CREATED_AT) {
          nodes { id createdAt cancelledAt test displayFinancialStatus displayFulfillmentStatus currentTotalPriceSet { shopMoney { amount currencyCode } }
            lineItems(first: 100) { nodes { id title currentQuantity } pageInfo { hasNextPage } }
          } pageInfo { hasNextPage endCursor }
        }
      }`, { query: `created_at:>=${period.start.toISOString()} created_at:<${end.toISOString()}`, after });
      const result = z.object({ orders: z.object({ nodes: z.array(orderSchema), pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }) }) }).parse(raw).orders;
      for (const item of result.nodes) {
        if (seen.has(item.id) || new Date(item.createdAt) < period.start || new Date(item.createdAt) >= end) throw new Error('Inconsistent order page');
        seen.add(item.id);
        if (item.test) { report.testOrdersExcluded++; continue; }
        if (item.cancelledAt) { report.cancelledOrders++; continue; }
        if (item.lineItems.pageInfo.hasNextPage) throw new ConflictError('An order exceeds 100 line items. A complete report could not be calculated.');
        const paid = item.displayFinancialStatus === 'PAID';
        report.orders++; if (paid) report.paidOrders++; else report.unpaidOrders++;
        if (['UNFULFILLED', 'PARTIALLY_FULFILLED', 'SCHEDULED', 'ON_HOLD'].includes(item.displayFulfillmentStatus)) report.unfulfilledOrders++;
        const money = item.currentTotalPriceSet.shopMoney;
        const bucket = currencies.get(money.currencyCode) || { total: 0n, paid: 0n };
        bucket.total += decimalUnits(money.amount); if (paid) bucket.paid += decimalUnits(money.amount);
        currencies.set(money.currencyCode, bucket);
        const lineIds = new Set<string>();
        for (const line of item.lineItems.nodes) {
          if (lineIds.has(line.id)) throw new Error('Duplicate line item');
          lineIds.add(line.id); report.units += line.currentQuantity;
          const key = line.title;
          const product = products.get(key) || { title: line.title, units: 0 };
          product.units += line.currentQuantity; products.set(key, product);
        }
      }
      if (!result.pageInfo.hasNextPage) {
        report.totals = [...currencies].sort(([a], [b]) => a.localeCompare(b)).map(([currency, values]) => ({ currency, orderValue: decimalText(values.total), paidOrderValue: decimalText(values.paid) }));
        report.topProducts = [...products.values()].filter(item => item.units > 0).sort((a, b) => b.units - a.units || a.title.localeCompare(b.title)).slice(0, 5);
        return report;
      }
      after = result.pageInfo.endCursor;
      if (!after || cursors.has(after)) throw new Error('Invalid report cursor');
      cursors.add(after);
    }
    throw new ConflictError('More than 2,000 orders match this period. Use a shorter reporting period; no partial total was reported.');
  } catch (error) {
    if (error instanceof ConflictError) throw error;
    throw new ServiceUnavailableError('Store report data could not be verified. Check the store connection and retry; no estimated totals were used.');
  }
}
export function formatStoreReport(report: StoreReport) {
  return `Store report — ${report.period}\nOrders: ${report.orders}; units: ${report.units}.\nOrder value: ${report.totals.map(t => `${t.orderValue} ${t.currency}`).join('; ') || 'No included orders'}.\nPaid orders: ${report.paidOrders}; other payment statuses: ${report.unpaidOrders}; awaiting fulfillment: ${report.unfulfilledOrders}.\nPaid-order value: ${report.totals.map(t => `${t.paidOrderValue} ${t.currency}`).join('; ') || 'None'}.\nTop products by units: ${report.topProducts.map(p => `${p.title}: ${p.units}`).join('; ') || 'None'}.\nExcluded: ${report.cancelledOrders} cancelled and ${report.testOrdersExcluded} test orders.\n${report.definition}\nChecked: ${report.checkedAt}`;
}
