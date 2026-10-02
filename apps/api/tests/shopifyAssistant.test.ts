import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/tools/shopifyTool', () => ({
  ShopifyTool: { checkStock: vi.fn() },
}));

import { ShopifyTool } from '../src/tools/shopifyTool';
import { llmService } from '../src/services/llmService';

describe('Shopify stock questions in the support assistant', () => {
  beforeEach(() => vi.clearAllMocks());

  it('answers a natural-language SKU question only from live Shopify tool output', async () => {
    vi.mocked(ShopifyTool.checkStock).mockResolvedValue({
      success: true,
      provider: 'shopify',
      action: 'check_stock',
      sku: 'sku-managed-1',
      inventoryItemId: 'gid://shopify/InventoryItem/1',
      availableQuantity: 100,
      locations: [
        { locationId: 'gid://shopify/Location/1', name: 'Shop location', availableQuantity: 50 },
        { locationId: 'gid://shopify/Location/2', name: 'Snow City Warehouse', availableQuantity: 50 },
      ],
      locationNamesAvailable: true,
    });

    const result = await llmService.generateSupportResponse({
      tenantId: 'tenant-yaseen',
      userMessage: 'sku-managed-1 ka stock kitna hai?',
      conversationHistory: [],
      ragChunks: [],
    });

    expect(ShopifyTool.checkStock).toHaveBeenCalledWith('tenant-yaseen', { sku: 'sku-managed-1' });
    expect(result).toMatchObject({
      source: 'shopify',
      confidence: 1,
      shouldEscalate: false,
      responseText: expect.stringContaining('100 available'),
    });
    expect(result.responseText).toContain('Shop location: 50');
    expect(result.responseText).toContain('Snow City Warehouse: 50');
  });

  it('asks for an exact SKU instead of guessing', async () => {
    const result = await llmService.generateSupportResponse({
      tenantId: 'tenant-yaseen',
      userMessage: 'How much stock is available?',
      conversationHistory: [],
      ragChunks: [],
    });

    expect(ShopifyTool.checkStock).not.toHaveBeenCalled();
    expect(result.responseText).toContain('exact product SKU');
    expect(result.shouldEscalate).toBe(false);
  });

  it('escalates when Shopify cannot provide current stock', async () => {
    vi.mocked(ShopifyTool.checkStock).mockRejectedValue(new Error('Provider unavailable'));

    const result = await llmService.generateSupportResponse({
      tenantId: 'tenant-yaseen',
      userMessage: 'Check stock for SKU: sku-managed-1',
      conversationHistory: [],
      ragChunks: [],
    });

    expect(result.shouldEscalate).toBe(true);
    expect(result.responseText).toContain('could not retrieve live stock');
  });
});
