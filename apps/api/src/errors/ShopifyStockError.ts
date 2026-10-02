export class ShopifyStockError extends Error {
  constructor(public readonly code: 'SKU_NOT_FOUND' | 'SKU_AMBIGUOUS' | 'INVENTORY_NOT_TRACKED') {
    super({ SKU_NOT_FOUND: 'SKU was not found', SKU_AMBIGUOUS: 'SKU is ambiguous; use a unique SKU', INVENTORY_NOT_TRACKED: 'Inventory is not tracked for this SKU' }[code]);
  }
}
