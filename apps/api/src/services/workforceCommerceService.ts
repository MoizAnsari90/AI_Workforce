import { z } from 'zod';
import { ShopifyClient } from './shopifyClient';
import { IntegrationService } from './integrationService';
import { getBusinessProfile } from './businessProfileService';
import { parseWorkforcePeriod, requestsSpecificPeriod } from './workforcePeriod';

// Merchant dashboard only. Never expose this service through customer chat.
const help = 'I can check current stock by exact SKU, stock and prices by product name (in double quotes), an order such as Order #1001, a sales summary for today/yesterday/this month, and low-stock products below a quantity. I cannot verify profit, forecasts, best sellers or customer-specific reports yet.';
const reply = (answer: string, status = 'clarification', data = {}) => ({ answer, status, source: status === 'success' || status === 'partial' ? 'shopify' : 'clarification', readOnly: true, checkedAt: new Date().toISOString(), ...data });
const pageInfo = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable().optional() });
const money = z.object({ amount: z.string().regex(/^-?\d+(?:\.\d{1,6})?$/), currencyCode: z.string().regex(/^[A-Z]{3}$/) });
const variant = z.object({ id: z.string(), title: z.string(), sku: z.string().nullable(), price: money.shape.amount, inventoryQuantity: z.number().int().nullable(), inventoryItem: z.object({ tracked: z.boolean() }) });
const product = z.object({ id: z.string(), title: z.string(), status: z.string(), variants: z.object({ nodes: z.array(variant), pageInfo }) });
const variantFields = 'id title sku price inventoryQuantity inventoryItem { tracked }';
const order = z.object({ id: z.string(), name: z.string(), createdAt: z.string().datetime(), cancelledAt: z.string().nullable(), test: z.boolean(), displayFinancialStatus: z.string().nullable(), displayFulfillmentStatus: z.string(), currentTotalPriceSet: z.object({ shopMoney: money }) });
const orderFields = 'id name createdAt cancelledAt test displayFinancialStatus displayFulfillmentStatus currentTotalPriceSet { shopMoney { amount currencyCode } }';
const normalize = (value: string) => value.trim().toLocaleLowerCase();
const can = (permissions: readonly string[], permission: string) => permissions.includes('admin:all') || permissions.includes(permission);
const decimalUnits = (amount: string) => { const negative = amount.startsWith('-'); const [whole, fraction = ''] = amount.replace(/^-/, '').split('.'); return BigInt(whole + fraction.padEnd(6, '0')) * (negative ? -1n : 1n); };
const decimalText = (value: bigint) => { const sign = value < 0n ? '-' : ''; const digits = (value < 0n ? -value : value).toString().padStart(7, '0'); return sign + digits.slice(0, -6) + '.' + digits.slice(-6).replace(/0+$/, '').padEnd(2, '0'); };

export async function answerWorkforceCommerceQuestion(tenantId: string, question: string, permissions: readonly string[]) {
  const q = question.trim();
  if (/\b(tasks?|approvals?|messages?|replies|alerts?)\b/i.test(q) && !/\b(shopify|store|orders?|products?|sales|revenue)\b/i.test(q)) return null;
  if (/\b(refund|cancel|delete|remove|update|change|set|adjust|create|send|publish)\b/i.test(q) && /\b(order|product|stock|inventory|price|customer|message)\b/i.test(q)) {
    return reply('This assistant is read only. No store change was made. Use the appropriate workflow and its approval controls for changes.', 'read_only');
  }
  const skuQuestion = /\bsku(?:s|[-\s:#=])/i.test(q);
  const lowStock = /\b(low[- ]stock|out[- ]of[- ]stock)\b/i.test(q) && !/\balerts?\b/i.test(q);
  const sales = /\b(sales|revenue|orders?\s+(?:summary|count)|how many orders|kitn[aei]\s+orders)\b/i.test(q);
  const orderIntent = /\border\b/i.test(q) && !sales;
  const quoted = q.match(/"([^"\n]{1,255})"/);
  const productIntent = !skuQuestion && !lowStock && !sales && !orderIntent && (/\b(product|price|pricing)\b/i.test(q) || Boolean(quoted && /\b(stock|inventory|available|quantity)\b/i.test(q)));
  const storeIntent = /\b(shopify|store|catalog|customers?|profit|best[- ]sell\w*|forecast|revenue)\b/i.test(q);
  if (skuQuestion && /\b(price|pricing|sales|profit|forecast|history)\b/i.test(q)) return reply('Exact-SKU questions currently verify current stock. For catalog price, ask for a product name in double quotes. Other SKU analytics are not available.', 'unsupported');
  if (!lowStock && !sales && !orderIntent && !productIntent) {
    if (skuQuestion || /\b(stock|inventory)\b/i.test(q)) return null;
    return storeIntent ? reply(help, 'unsupported') : null;
  }
  if (/\b(profit|margin|net sales|best[- ]sell\w*|forecast|compare|versus|vs|customer|refunds|discount|tax|shipping|paid|unpaid|fulfilled|unfulfilled|average|by product|per product|by country|by channel)\b/i.test(q) && !orderIntent) return reply(help, 'unsupported');
  if (sales && !can(permissions, 'finance:read')) return reply('Sales summaries require finance:read permission in this workspace.', 'forbidden');
  if (orderIntent && !can(permissions, 'sales:read')) return reply('Order lookup requires sales:read permission in this workspace.', 'forbidden');
  if (productIntent && !quoted) return reply('Put the product name in double quotes, for example: What is the stock and price of "HR Clothing part"? You can also provide an exact SKU.', 'needs_product');
  if (productIntent && [...q.matchAll(/"([^"\n]+)"/g)].length !== 1) return reply('Check one product name at a time, in double quotes.', 'needs_product');
  if ((productIntent || lowStock) && requestsSpecificPeriod(q)) return reply('Only current product stock and prices can be verified. Historical inventory is not available.', 'unsupported_period');
  const orderMatch = q.match(/\border\s+(?:number\s*|no\.?\s*)?(#[a-z0-9_-]+|[0-9]+|"[^"\n]{1,80}")/i);
  if (orderIntent && !orderMatch) return reply('Please provide one exact order name, for example Order #1001. Do not enter customer contact details.', 'needs_order');
  if (orderIntent && /\b(and|aur)\b|,/i.test(q)) return reply('Check one order at a time using its exact order name.', 'needs_order');
  try {
    if (await IntegrationService.getCredential(tenantId, 'woocommerce')) return reply('These product-name, order and sales reports currently support Shopify. For WooCommerce, ask for current stock by exact SKU.', 'unsupported_provider');
    const client = await ShopifyClient.forTenant(tenantId);
    const connection = await client.verifyConnection();
    const scopes = connection.currentAppInstallation.accessScopes.map(item => item.handle);
    const required = sales || orderIntent ? ['read_orders'] : ['read_products', 'read_inventory'];
    const missing = required.filter(scope => !scopes.includes(scope) && !scopes.includes(scope.replace('read_', 'write_')));
    if (missing.length) return reply('The store connection needs additional permission for this question. Ask your platform administrator to enable product/order read access, then reconnect Shopify in Integrations.', 'missing_scope', { missingScopes: missing });

    if (productIntent) {
      const title = quoted![1].trim();
      const raw: unknown = await client.query(`query AssistantProducts($query: String!) { shop { currencyCode } products(first: 10, query: $query) { nodes { id title status variants(first: 20) { nodes { ${variantFields} } pageInfo { hasNextPage } } } pageInfo { hasNextPage } } }`, { query: `title:${JSON.stringify(title)}` });
      const result = z.object({ shop: z.object({ currencyCode: money.shape.currencyCode }), products: z.object({ nodes: z.array(product), pageInfo }) }).parse(raw);
      const matches = result.products.nodes.filter(item => normalize(item.title) === normalize(title));
      if (result.products.pageInfo.hasNextPage || matches.length !== 1) return reply(matches.length || result.products.nodes.length ? 'The product name is ambiguous or the search is incomplete. Use an exact unique product title or SKU. Matching titles: ' + result.products.nodes.map(item => item.title).join('; ') : 'No accessible product matched that title. Check the exact title in Shopify.', matches.length || result.products.nodes.length ? 'ambiguous' : 'not_found');
      const item = matches[0];
      if (!item.variants.nodes.length) return reply('This product returned no accessible variants. A price or quantity could not be verified.', 'unavailable');
      const lines = item.variants.nodes.map(v => `${v.title}${v.sku ? ` (SKU ${v.sku})` : ' (no SKU)'}: price ${v.price} ${result.shop.currencyCode}; ${v.inventoryItem.tracked && v.inventoryQuantity !== null ? `${v.inventoryQuantity} available units across locations` : 'inventory quantity is not tracked/available'}.`);
      return reply(`${item.title} — ${item.status}.\n${lines.join('\n')}\n${item.variants.pageInfo.hasNextPage ? 'Partial result: first 20 variants only. Use a SKU for another variant. ' : ''}Prices are catalog prices, not a checkout quote.`, item.variants.pageInfo.hasNextPage ? 'partial' : 'success');
    }
    if (orderIntent) {
      const name = orderMatch![1].replace(/^"|"$/g, '');
      const expected = /^\d+$/.test(name) ? '#' + name : name;
      const raw: unknown = await client.query(`query AssistantOrder($query: String!) { orders(first: 20, query: $query) { nodes { ${orderFields} } pageInfo { hasNextPage } } }`, { query: `name:${JSON.stringify(expected)}` });
      const result = z.object({ orders: z.object({ nodes: z.array(order), pageInfo }) }).parse(raw);
      const matches = result.orders.nodes.filter(item => normalize(item.name) === normalize(expected));
      if (result.orders.pageInfo.hasNextPage || matches.length > 1) return reply('Order search is ambiguous or incomplete. No order was selected.', 'ambiguous');
      if (!matches.length) return reply('No accessible order matched that exact name. Check the order name. Older orders may be outside the connection’s permitted history.', 'not_found');
      const item = matches[0], total = item.currentTotalPriceSet.shopMoney;
      return reply(`Order ${item.name}${item.test ? ' (test order)' : ''}: payment ${item.displayFinancialStatus || 'unknown'}; fulfillment ${item.displayFulfillmentStatus}; ${item.cancelledAt ? `cancelled at ${item.cancelledAt}` : 'not cancelled'}. Current order total: ${total.amount} ${total.currencyCode}. Created ${item.createdAt}. Fulfillment status does not confirm delivery.`, 'success');
    }
    if (lowStock) {
      const thresholdMatch = q.match(/\b(?:below|under|less than)\s+(\d+)\b(?!\.\d)/i);
      if (/\d/.test(q) && !thresholdMatch) return reply('Specify the threshold as “Low-stock products below 10”. Other stock filters are not supported in this report.', 'invalid_threshold');
      const threshold = /\bout[- ]of[- ]stock\b/i.test(q) ? 1 : thresholdMatch ? Number(thresholdMatch[1]) : 10;
      if (!Number.isSafeInteger(threshold) || threshold < 0 || threshold > 100000) return reply('Use a low-stock threshold between 0 and 100000.', 'invalid_threshold');
      let after: string | null = null, scanned = 0, untracked = 0, more = false;
      const seen = new Set<string>(), cursors = new Set<string>(), lines: string[] = [];
      for (let page = 0; page < 4; page++) {
        const raw: unknown = await client.query(`query AssistantLowStock($after: String) { productVariants(first: 50, after: $after) { nodes { ${variantFields} product { title status } } pageInfo { hasNextPage endCursor } } }`, { after });
        const result = z.object({ productVariants: z.object({ nodes: z.array(variant.extend({ product: z.object({ title: z.string(), status: z.string() }) })), pageInfo }) }).parse(raw).productVariants;
        for (const item of result.nodes) {
          if (seen.has(item.id)) throw new Error('Duplicate provider item');
          seen.add(item.id); scanned++;
          if (!item.inventoryItem.tracked || item.inventoryQuantity === null) { untracked++; continue; }
          if (item.inventoryQuantity < threshold) lines.push(`${item.product.title} / ${item.title} (${item.sku || 'no SKU'}, ${item.product.status}): ${item.inventoryQuantity} available.`);
        }
        more = result.pageInfo.hasNextPage;
        if (!more) break;
        after = result.pageInfo.endCursor || null;
        if (!after || cursors.has(after)) throw new Error('Invalid provider cursor');
        cursors.add(after);
      }
      return reply(`${more ? 'Partial catalog scan' : 'Catalog scan'}: ${scanned} variants checked, ${untracked} without a verified stock count. ${lines.length} below ${threshold} available units across locations. Includes draft/archived products.\n${lines.slice(0, 30).join('\n') || 'No matching tracked variants in the scanned set.'}${lines.length > 30 ? '\nShowing the first 30 matches.' : ''}${more ? '\nThe scan limit is 200 variants; this is not a full-store report.' : ''}`, more || lines.length > 30 ? 'partial' : 'success');
    }
    const now = new Date();
    // Reject comparisons/ranges instead of silently using the first date.
    if (/\b(and|aur|from|between|to|through)\b|\d{4}-\d{2}-\d{2}.*\d{4}-\d{2}-\d{2}/i.test(q)) return reply('Choose one period: today, yesterday, this week, last week, this month, last month, or one ISO date.', 'unsupported_period');
    const { profile } = await getBusinessProfile(tenantId);
    const period = parseWorkforcePeriod(q, now, profile?.timezone || 'Asia/Karachi');
    if (!period || period.start >= now || period.end.getTime() - period.start.getTime() > 32 * 86400000) return reply('Choose a past/current period of up to 31 days, for example “Sales summary today” or “Sales summary this month”.', 'needs_period');
    if (!scopes.includes('read_all_orders') && period.start.getTime() < now.getTime() - 60 * 86400000) return reply('That period is outside the connection’s default 60-day order history. No total was calculated.', 'history_unavailable');
    const end = new Date(Math.min(now.getTime(), period.end.getTime()));
    const query = `created_at:>=${period.start.toISOString()} created_at:<${end.toISOString()}`;
    const totals = new Map<string, bigint>();
    const seen = new Set<string>(), cursors = new Set<string>();
    let after: string | null = null, count = 0, excluded = 0;
    for (let page = 0; page < 5; page++) {
      const raw: unknown = await client.query(`query AssistantSales($query: String!, $after: String) { orders(first: 100, after: $after, query: $query, sortKey: CREATED_AT) { nodes { ${orderFields} } pageInfo { hasNextPage endCursor } } }`, { query, after });
      const result = z.object({ orders: z.object({ nodes: z.array(order), pageInfo }) }).parse(raw).orders;
      for (const item of result.nodes) {
        if (seen.has(item.id) || new Date(item.createdAt) < period.start || new Date(item.createdAt) >= end) throw new Error('Inconsistent provider results');
        seen.add(item.id);
        if (item.test || item.cancelledAt) { excluded++; continue; }
        const total = item.currentTotalPriceSet.shopMoney;
        totals.set(total.currencyCode, (totals.get(total.currencyCode) || 0n) + decimalUnits(total.amount)); count++;
      }
      if (!result.pageInfo.hasNextPage) return reply(`Orders created during ${period.label}, checked through ${end.toISOString()}: ${count} non-test, non-cancelled orders; ${excluded} test/cancelled orders excluded. Current order totals: ${[...totals].map(([currency, total]) => decimalText(total) + ' ' + currency).join('; ') || 'none (no included orders)'}. These are current order values including unpaid orders, not net sales, collected payments or profit. Refunds/edits to these orders can change this total.`, 'success');
      after = result.pageInfo.endCursor || null;
      if (!after || cursors.has(after)) throw new Error('Invalid provider cursor');
      cursors.add(after);
    }
    return reply('More than 500 orders match this period. Choose a shorter period. No incomplete sales total was returned.', 'limit_reached');
  } catch {
    return reply('Live store data could not be verified. Check the Shopify connection and permissions in Integrations, then retry. No quantity, order status or sales total was guessed.', 'provider_unavailable');
  }
}
