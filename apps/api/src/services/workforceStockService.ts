import { ShopifyTool } from '../tools/shopifyTool';
import { ShopifyStockError } from '../errors/ShopifyStockError';
import { requestsSpecificPeriod } from './workforcePeriod';
import { IntegrationService } from './integrationService';
import { WooCommerceClient, woocommerceCredentialSchema } from './woocommerceClient';

const reserved = /^(ka|ki|is|hai|stock|please|dono|both|inventory|quantity|current|available)$/i;
function extractSkus(question: string): string[] {
  const skus = new Set<string>();
  const token = /^(?:["']([^"']+)["']|([a-z0-9][a-z0-9._-]*))/i;
  for (const match of question.matchAll(/\bskus?(?:\s+(?:(?:is|hai)\s+)?|\s*[:#=]\s*)/gi)) {
    let tail = question.slice(match.index! + match[0].length);
    while (true) {
      const item = tail.match(token);
      if (!item) break;
      const sku = (item[1] || item[2]).replace(/[.?]+$/, '');
      if (reserved.test(sku) || /^sku$/i.test(sku)) break;
      skus.add(sku);
      tail = tail.slice(item[0].length);
      const separator = tail.match(/^\s*(?:,\s*(?:(?:and|aur)\s+)?|(?:and|aur|&)\s+)(?:sku\s*[:#=]?\s+)?/i);
      if (!separator) break;
      tail = tail.slice(separator[0].length);
    }
  }
  if (!skus.size) for (const match of question.matchAll(/\bsku-[a-z0-9][a-z0-9._-]*/gi)) skus.add(match[0].replace(/[.?]+$/, ''));
  return [...skus];
}

export async function answerWorkforceStockQuestion(tenantId: string, question: string) {
  const skus = extractSkus(question);
  const stockIntent = /\b(stock|inventory|quantity)\b/i.test(question) ||
    (/\b(available|availability|av[a-z]*able)\b/i.test(question) && /\b(product|item|shopify|store)\b/i.test(question));
  const metricsIntent = /\b(alerts?|records?|metrics|summary)\b/i.test(question);
  if (!skus.length && (!stockIntent || metricsIntent)) return null;
  const wooConfig = await IntegrationService.getCredential(tenantId, 'woocommerce');
  const commerceProvider = wooConfig ? 'woocommerce' : 'shopify';
  if (requestsSpecificPeriod(question)) return { answer: 'Historical/date-filtered stock is not supported yet. I can check current live store stock if you provide the exact SKU.', source: 'clarification', readOnly: true, status: 'unsupported_period' };
  if (!skus.length || skus.length > 5) return {
    answer: skus.length > 5 ? 'Please request up to 5 SKUs at a time. No stock lookup was performed.' : 'Please share the exact product SKU. For example: "Check stock for SKU: sku-managed-1". Product-name search is not available yet.',
    source: 'clarification', readOnly: true, status: 'needs_sku',
  };
  // Sequential reads limit provider load; a failed SKU does not hide other results.
  const results = [];
  for (const sku of skus) {
    try {
      if (commerceProvider === 'woocommerce') {
        const config = woocommerceCredentialSchema.safeParse(wooConfig);
        if (!config.success) throw new Error('WooCommerce credentials need reconnection');
        const client = new WooCommerceClient(config.data);
        const query = new URLSearchParams({ sku, per_page: '100' });
        const products = await client.request<Array<{ id: number; sku: string; name: string; manage_stock: boolean; stock_quantity: number | null; stock_status: string }>>(`products?${query}`);
        const matching = products.filter(product => product.sku?.trim().toLowerCase() === sku.trim().toLowerCase());
        if (!matching.length) throw new ShopifyStockError('SKU_NOT_FOUND');
        if (matching.length !== 1) throw new ShopifyStockError('SKU_AMBIGUOUS');
        const product = matching[0];
        if (!product.manage_stock || product.stock_quantity === null) throw new ShopifyStockError('INVENTORY_NOT_TRACKED');
        const checkedAt = new Date().toISOString();
        const availableQuantity = Math.max(0, product.stock_quantity);
        results.push({ sku, status: 'success', stock: { sku: product.sku, productName: product.name, availableQuantity, stockStatus: product.stock_status }, checkedAt,
          answer: `Live WooCommerce stock for SKU ${product.sku} (${product.name}): ${availableQuantity} available units. WooCommerce does not provide location-level stock in this connector. Checked at ${checkedAt}.` });
        continue;
      }
      const stock = await ShopifyTool.checkStock(tenantId, { sku });
      const checkedAt = new Date().toISOString();
      const locations = stock.locations.map(location => (location.name || location.locationId) + ': ' + location.availableQuantity + ' units').join('; ');
      results.push({ sku, status: 'success', stock, checkedAt,
        answer: 'Live Shopify stock for SKU ' + stock.sku + ': ' + stock.availableQuantity + ' available units. ' + (locations ? 'By location: ' + locations + '. ' : 'No stocked locations were returned. ') + 'Source: Shopify Admin API. Checked at ' + checkedAt + '.' });
    } catch (error) {
      const code = error instanceof ShopifyStockError ? error.code : 'PROVIDER_UNAVAILABLE';
      const messages = {
        SKU_NOT_FOUND: `SKU not found in the connected ${commerceProvider === 'woocommerce' ? 'WooCommerce' : 'Shopify'} store. Check the exact SKU.`,
        SKU_AMBIGUOUS: 'The SKU search is ambiguous or incomplete. Use a unique SKU; no quantity was selected.',
        INVENTORY_NOT_TRACKED: `${commerceProvider === 'woocommerce' ? 'WooCommerce' : 'Shopify'} does not track inventory for this SKU; an available quantity cannot be verified.`,
        PROVIDER_UNAVAILABLE: `Live ${commerceProvider === 'woocommerce' ? 'WooCommerce' : 'Shopify'} stock could not be verified. Check the store connection in Integrations and try again.`,
      };
      results.push({ sku, status: 'unavailable', code, answer: 'SKU ' + sku + ': ' + messages[code] });
    }
  }
  if (results.length === 1) return { ...results[0], source: commerceProvider, readOnly: true };
  const successful = results.filter(result => result.status === 'success').length;
  return { answer: results.map(result => result.answer).join('\n\n'), source: commerceProvider, readOnly: true,
    status: successful === results.length ? 'success' : successful ? 'partial' : 'unavailable', results };
}
