import { z } from 'zod';
import { ShopifyClient } from '../services/shopifyClient';
import { ShopifyStockError } from '../errors/ShopifyStockError';

const gid = (type: string) => z.string().regex(new RegExp(`^gid://shopify/${type}/[0-9]+$`), `Expected a Shopify ${type} GID`);
export const shopifyRefundSchema = z.object({
  orderId: gid('Order'), amount: z.number().finite().positive(), currency: z.string().regex(/^[A-Z]{3}$/),
  parentTransactionId: gid('OrderTransaction'), reason: z.string().max(500).optional(),
}).strict();
export const shopifyStockSchema = z.object({ sku: z.string().trim().min(1).max(255), locationId: gid('Location').optional() }).strict();
export const shopifyCancelSchema = z.object({
  orderId: gid('Order'), reason: z.enum(['CUSTOMER', 'FRAUD', 'INVENTORY', 'DECLINED', 'OTHER', 'STAFF']).default('OTHER'),
  restock: z.boolean().default(false), refund: z.boolean().default(false),
}).strict();
export type ShopifyRefundParams = z.infer<typeof shopifyRefundSchema>;
export type ShopifyStockParams = z.infer<typeof shopifyStockSchema>;
export type ShopifyCancelParams = z.infer<typeof shopifyCancelSchema>;
type UserError = { message: string; field?: string[] };
function checkErrors(errors: UserError[]) {
  if (errors.length) throw new Error(`Shopify action rejected: ${errors.map(e => e.message).join('; ')}`);
}
export class ShopifyTool {
  static async processRefund(tenantId: string, input: ShopifyRefundParams, idempotencyKey: string) {
    const params = shopifyRefundSchema.parse(input);
    z.string().uuid().parse(idempotencyKey);
    const client = await ShopifyClient.forTenant(tenantId, true);
    const { order } = await client.query<{ order: null | { transactions: Array<{ id: string; kind: string; status: string; gateway: string; amountSet: { presentmentMoney: { amount: string; currencyCode: string } } }> } }>(
      'query RefundPayment($id: ID!) { order(id: $id) { transactions { id kind status gateway amountSet { presentmentMoney { amount currencyCode } } } } }', { id: params.orderId });
    const payment = order?.transactions.find(t => t.id === params.parentTransactionId && t.status === 'SUCCESS' && ['SALE', 'CAPTURE'].includes(t.kind));
    if (!payment || payment.amountSet.presentmentMoney.currencyCode !== params.currency || Number(payment.amountSet.presentmentMoney.amount) < params.amount) {
      throw new Error('Refund must reference a successful payment on this order, in its currency, within the payment amount');
    }
    const { refundCreate } = await client.query<{ refundCreate: { userErrors: UserError[]; refund: null | { id: string; transactions: { nodes: Array<{ id: string; status: string }> } } } }>(
      `mutation RefundPayment($input: RefundInput!, $key: String!) {
        refundCreate(input: $input) @idempotent(key: $key) { userErrors { field message } refund { id transactions(first: 10) { nodes { id status } } } }
      }`, { key: idempotencyKey, input: {
        orderId: params.orderId, currency: params.currency, note: params.reason, notify: false,
        transactions: [{ orderId: params.orderId, parentId: params.parentTransactionId, gateway: payment.gateway, kind: 'REFUND', amount: String(params.amount) }],
      } });
    checkErrors(refundCreate.userErrors);
    const refund = refundCreate.refund;
    if (!refund || !refund.transactions.nodes.length) throw new Error('Shopify did not confirm a refund transaction; reconcile before retrying');
    if (refund.transactions.nodes.some(t => ['FAILURE', 'ERROR'].includes(t.status))) throw new Error('Shopify refund payment failed; reconcile before retrying');
    const complete = refund.transactions.nodes.every(t => t.status === 'SUCCESS');
    return { success: complete, provider: 'shopify', action: 'refund', orderId: params.orderId, refundId: refund.id,
      amount: params.amount, currency: params.currency, status: complete ? 'processed' : 'pending', transactions: refund.transactions.nodes };
  }
  static async checkStock(tenantId: string, input: ShopifyStockParams) {
    const params = shopifyStockSchema.parse(input);
    const client = await ShopifyClient.forTenant(tenantId);
    const { inventoryItems } = await client.query<{ inventoryItems: { nodes: Array<{ id: string; sku: string; tracked: boolean }>; pageInfo: { hasNextPage: boolean } } }>(
      'query StockItem($query: String!) { inventoryItems(first: 100, query: $query) { nodes { id sku tracked } pageInfo { hasNextPage } } }', { query: `sku:${JSON.stringify(params.sku)}` });
    const matches = inventoryItems.nodes.filter(item => item.sku === params.sku);
    if (inventoryItems.pageInfo.hasNextPage || matches.length > 1) throw new ShopifyStockError('SKU_AMBIGUOUS');
    if (!matches.length) throw new ShopifyStockError('SKU_NOT_FOUND');
    if (!matches[0].tracked) throw new ShopifyStockError('INVENTORY_NOT_TRACKED');
    const { currentAppInstallation } = await client.verifyConnection();
    const includeLocationNames = currentAppInstallation.accessScopes.some(scope => ['read_locations', 'read_markets_home'].includes(scope.handle));
    type Level = { location: { id: string; name?: string }; quantities: Array<{ name: string; quantity: number }> };
    const locations: Array<{ locationId: string; name: string | null; availableQuantity: number }> = [];
    let after: string | null = null;
    do {
      const data: { inventoryItem: { inventoryLevels: { nodes: Level[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } } = await client.query(
        `query StockLevels($id: ID!, $after: String) { inventoryItem(id: $id) { inventoryLevels(first: 100, after: $after) { nodes { location { id ${includeLocationNames ? 'name' : ''} } quantities(names: ["available"]) { name quantity } } pageInfo { hasNextPage endCursor } } } }`,
        { id: matches[0].id, after });
      const levels = data.inventoryItem.inventoryLevels;
      for (const level of levels.nodes) {
        const available = level.quantities.find(q => q.name === 'available');
        if (!available) throw new Error('Shopify did not return available inventory');
        if (!params.locationId || params.locationId === level.location.id) locations.push({ locationId: level.location.id, name: level.location.name ?? null, availableQuantity: available.quantity });
      }
      if (levels.pageInfo.hasNextPage && (!levels.pageInfo.endCursor || levels.pageInfo.endCursor === after)) throw new Error('Shopify returned an invalid inventory cursor');
      after = levels.pageInfo.hasNextPage ? levels.pageInfo.endCursor : null;
    } while (after);
    if (params.locationId && !locations.length) throw new Error('This SKU is not stocked at the requested location');
    return { success: true, provider: 'shopify', action: 'check_stock', sku: params.sku, inventoryItemId: matches[0].id,
      availableQuantity: locations.reduce((sum, l) => sum + l.availableQuantity, 0), locations, locationNamesAvailable: includeLocationNames };
  }
  static async cancelOrder(tenantId: string, input: ShopifyCancelParams) {
    const params = shopifyCancelSchema.parse(input);
    const client = await ShopifyClient.forTenant(tenantId, true);
    const { orderCancel } = await client.query<{ orderCancel: { userErrors: UserError[]; orderCancelUserErrors: UserError[]; job: { id: string; done: boolean } | null } }>(
      `mutation CancelOrder($orderId: ID!, $reason: OrderCancelReason!, $restock: Boolean!, $refundMethod: OrderCancelRefundMethodInput!) {
        orderCancel(orderId: $orderId, reason: $reason, restock: $restock, refundMethod: $refundMethod, notifyCustomer: false) {
          job { id done } userErrors { field message } orderCancelUserErrors { field message }
        }
      }`, { orderId: params.orderId, reason: params.reason, restock: params.restock, refundMethod: { originalPaymentMethodsRefund: params.refund } });
    checkErrors([...orderCancel.userErrors, ...orderCancel.orderCancelUserErrors]);
    if (!orderCancel.job) throw new Error('Shopify did not confirm a cancellation job; reconcile before retrying');
    return { success: false, provider: 'shopify', action: 'cancel_order', orderId: params.orderId, status: 'pending', jobId: orderCancel.job.id };
  }
}
