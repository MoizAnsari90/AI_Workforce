import { prisma } from '../lib/prisma';
import { ShopifyClient, shopifyCredentialSchema } from '../services/shopifyClient';
import { exchangeShopifyCredentials } from '../services/shopifyAuth';
import { IntegrationService } from '../services/integrationService';
import { ShopifyTool } from '../tools/shopifyTool';
import { llmService } from '../services/llmService';

async function fromEnvironment() {
  const shop = process.env.SHOPIFY_SHOP || '';
  const token = process.env.SHOPIFY_CLIENT_ID || process.env.SHOPIFY_CLIENT_SECRET
    ? await exchangeShopifyCredentials(shop, process.env.SHOPIFY_CLIENT_ID || '', process.env.SHOPIFY_CLIENT_SECRET || '')
    : { accessToken: process.env.SHOPIFY_ACCESS_TOKEN };
  const result = shopifyCredentialSchema.safeParse({ shop, ...token, allowWrites: false });
  if (!result.success) throw new Error('Set a valid SHOPIFY_SHOP and Shopify credentials in apps/api/.env');
  return result.data;
}
async function main() {
  // Verify provider access without needing or modifying a platform tenant.
  if (process.argv.includes('--verify')) {
    const config = await fromEnvironment();
    const client = new ShopifyClient(config);
    const connection = await client.verifyConnection();
    console.log(JSON.stringify({ verified: true, persisted: false, allowWrites: false, expiresAt: config.expiresAt, ...connection }, null, 2));
    const inventory = await client.query(
      'query InventoryProbe { inventoryItems(first: 3) { nodes { sku tracked inventoryLevels(first: 3) { nodes { id quantities(names: ["available"]) { name quantity } } } } } }');
    console.log(JSON.stringify({ inventorySample: inventory, note: 'Sample only; not a complete inventory total' }, null, 2));
    return;
  }
  const tenantId = process.env.SHOPIFY_TENANT_ID;
  if (!tenantId) throw new Error('Set SHOPIFY_TENANT_ID in apps/api/.env; use --verify to test Shopify without a tenant');
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
  if (!tenant) throw new Error('SHOPIFY_TENANT_ID does not identify an existing tenant');
  if (process.argv.includes('--connect')) {
    const config = await fromEnvironment();
    const connection = await new ShopifyClient(config).verifyConnection();
    if (!connection.currentAppInstallation.accessScopes.some(s => ['read_inventory', 'write_inventory'].includes(s.handle))) throw new Error('App needs inventory access');
    await IntegrationService.storeCredential({ tenantId, provider: 'shopify', config });
    console.log(JSON.stringify({ connected: true, allowWrites: false, expiresAt: config.expiresAt, ...connection }, null, 2));
  } else {
    const client = await ShopifyClient.forTenant(tenantId, false, process.argv.includes('--refresh'));
    console.log(JSON.stringify(await client.verifyConnection(), null, 2));
  }
  if (process.env.SHOPIFY_TEST_SKU) {
    console.log(JSON.stringify(await ShopifyTool.checkStock(tenantId, { sku: process.env.SHOPIFY_TEST_SKU }), null, 2));
    if (process.argv.includes('--assistant')) {
      const assistantResult = await llmService.generateSupportResponse({
        tenantId,
        userMessage: `What is the live stock for SKU ${process.env.SHOPIFY_TEST_SKU}?`,
        conversationHistory: [],
        ragChunks: [],
      });
      console.log(JSON.stringify({ assistantTest: assistantResult, externalMessageSent: false }, null, 2));
    }
  }
}
main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Shopify connection test failed');
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
