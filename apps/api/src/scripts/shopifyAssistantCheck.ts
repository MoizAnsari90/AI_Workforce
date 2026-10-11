import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { ShopifyClient } from '../services/shopifyClient';
import { answerWorkforceCommerceQuestion } from '../services/workforceCommerceService';

// Read-only smoke check. Prints statuses only, never credentials or customer data.
async function main() {
  const tenantId = process.env.SHOPIFY_TENANT_ID;
  if (!tenantId && !process.argv.includes('--all-connected')) throw new Error('Set SHOPIFY_TENANT_ID or explicitly pass --all-connected');
  const stores = await prisma.externalIntegrationCredential.findMany({ where: { provider: 'shopify', isActive: true, ...(tenantId && !process.argv.includes('--all-connected') ? { tenantId } : {}) }, select: { tenantId: true }, take: 5 });
  if (!stores.length) throw new Error('No connected Shopify workspace found');
  for (const store of stores) {
    const checks: Record<string, unknown> = { tenantId: store.tenantId };
    try {
      const client = await ShopifyClient.forTenant(store.tenantId);
      const connection = await client.verifyConnection();
      const scopes = connection.currentAppInstallation.accessScopes.map(scope => scope.handle);
      checks.connected = true; checks.scopes = scopes;
      const permissions = ['operations:read', 'sales:read', 'finance:read'];
      if (scopes.includes('read_products') || scopes.includes('write_products')) {
        const products = await client.query<{ products: { nodes: Array<{ title: string }> } }>('query AssistantSmokeProduct { products(first: 1) { nodes { title } } }');
        const title = products.products.nodes[0]?.title;
        checks.product = title && !title.includes('"') ? (await answerWorkforceCommerceQuestion(store.tenantId, `Stock and price of product "${title}"`, permissions))?.status : 'no_suitable_product';
      } else checks.product = 'missing_read_products_scope';
      checks.lowStock = (await answerWorkforceCommerceQuestion(store.tenantId, 'Low-stock products below 10', permissions))?.status;
      checks.sales = (await answerWorkforceCommerceQuestion(store.tenantId, 'Sales summary today', permissions))?.status;
      const orders = await client.query<{ orders: { nodes: Array<{ name: string }> } }>('query AssistantSmokeOrder { orders(first: 1, sortKey: CREATED_AT, reverse: true) { nodes { name } } }');
      const name = orders.orders.nodes[0]?.name;
      checks.order = (await answerWorkforceCommerceQuestion(store.tenantId, `Order "${name || '#AIWF-NONEXISTENT-SMOKE-CHECK'}" status`, permissions))?.status;
      checks.orderFixture = name ? 'existing_order' : 'not_found_path_only';
    } catch { checks.providerCheck = 'unavailable'; }
    console.log(JSON.stringify(checks));
  }
}
main().catch(() => { console.error('Shopify assistant smoke check could not finish. Check the database, tenant selection and provider connection.'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
