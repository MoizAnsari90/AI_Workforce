import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ConflictError, NotFoundError, ValidationError } from '../errors/AppError';
import { recordAuditLog } from './auditService';

function decimal(value: number) {
  return new Prisma.Decimal(value);
}

export const operationsService = {
  async getPolicy(tenantId: string) {
    return prisma.operationsPolicy.upsert({
      where: { tenantId },
      update: {},
      create: { tenantId },
    });
  },

  async updatePolicy(tenantId: string, input: { highValuePurchaseThreshold?: number; lowStockAlertsEnabled?: boolean }, updatedBy: string) {
    if (input.highValuePurchaseThreshold != null && input.highValuePurchaseThreshold < 0) {
      throw new ValidationError('Purchase approval threshold cannot be negative');
    }
    const previous = await this.getPolicy(tenantId);
    const policy = await prisma.operationsPolicy.update({
      where: { tenantId },
      data: {
        ...(input.highValuePurchaseThreshold != null ? { highValuePurchaseThreshold: decimal(input.highValuePurchaseThreshold) } : {}),
        ...(input.lowStockAlertsEnabled !== undefined ? { lowStockAlertsEnabled: input.lowStockAlertsEnabled } : {}),
      },
    });
    await recordAuditLog({ tenantId, actorType: 'user', actorId: updatedBy, operation: 'update_operations_policy', entityType: 'operations_policy', entityId: policy.id, oldValue: previous, newValue: policy });
    return policy;
  },

  async createLocation(tenantId: string, input: { name: string; locationType?: string }, createdBy: string) {
    const location = await prisma.warehouseLocation.create({ data: { tenantId, name: input.name, locationType: input.locationType } });
    await recordAuditLog({ tenantId, actorType: 'user', actorId: createdBy, operation: 'create_location', entityType: 'warehouse_location', entityId: location.id, newValue: location });
    return location;
  },

  async listLocations(tenantId: string) {
    return prisma.warehouseLocation.findMany({ where: { tenantId, isActive: true }, orderBy: { name: 'asc' } });
  },

  async createSupplier(tenantId: string, input: { name: string; email?: string; phone?: string }, createdBy: string) {
    const supplier = await prisma.supplier.create({ data: { tenantId, ...input } });
    await recordAuditLog({ tenantId, actorType: 'user', actorId: createdBy, operation: 'create_supplier', entityType: 'supplier', entityId: supplier.id, newValue: supplier });
    return supplier;
  },

  async listSuppliers(tenantId: string) {
    return prisma.supplier.findMany({ where: { tenantId, status: 'active' }, orderBy: { name: 'asc' } });
  },

  async createProduct(tenantId: string, input: { sku: string; name: string; description?: string; unitCost?: number; currency?: string; reorderPoint?: number; reorderQuantity?: number; supplierId?: string }, createdBy: string) {
    if ((input.reorderPoint ?? 0) < 0 || (input.reorderQuantity ?? 0) < 0 || (input.unitCost ?? 0) < 0) {
      throw new ValidationError('Product quantities and cost cannot be negative');
    }
    if (input.supplierId) {
      const supplier = await prisma.supplier.findFirst({ where: { id: input.supplierId, tenantId } });
      if (!supplier) throw new NotFoundError('Supplier not found');
    }
    const product = await prisma.product.create({
      data: {
        tenantId,
        sku: input.sku,
        name: input.name,
        description: input.description,
        unitCost: decimal(input.unitCost ?? 0),
        currency: input.currency ?? 'USD',
        reorderPoint: input.reorderPoint ?? 0,
        reorderQuantity: input.reorderQuantity ?? 0,
        supplierId: input.supplierId,
      },
    });
    await recordAuditLog({ tenantId, actorType: 'user', actorId: createdBy, operation: 'create_product', entityType: 'product', entityId: product.id, newValue: product });
    return product;
  },

  async listProducts(tenantId: string) {
    return prisma.product.findMany({ where: { tenantId, isActive: true }, include: { supplier: true, inventory: { include: { location: true } } }, orderBy: { name: 'asc' } });
  },

  async adjustInventory(tenantId: string, input: { productId: string; locationId: string; quantityDelta: number; reason: string; reference?: string }, performedBy: string) {
    if (!Number.isInteger(input.quantityDelta) || input.quantityDelta === 0) throw new ValidationError('Inventory adjustment must be a non-zero integer');
    const result = await prisma.$transaction(async (tx) => {
      const [product, location] = await Promise.all([
        tx.product.findFirst({ where: { id: input.productId, tenantId } }),
        tx.warehouseLocation.findFirst({ where: { id: input.locationId, tenantId, isActive: true } }),
      ]);
      if (!product) throw new NotFoundError('Product not found');
      if (!location) throw new NotFoundError('Location not found');
      const record = await tx.inventoryRecord.upsert({
        where: { tenantId_productId_locationId: { tenantId, productId: input.productId, locationId: input.locationId } },
        update: {},
        create: { tenantId, productId: input.productId, locationId: input.locationId, quantity: 0 },
      });
      const nextQuantity = record.quantity + input.quantityDelta;
      if (nextQuantity < record.reservedQuantity) throw new ConflictError('Inventory cannot fall below reserved quantity');
      const updated = await tx.inventoryRecord.update({ where: { id: record.id }, data: { quantity: nextQuantity } });
      const movement = await tx.inventoryMovement.create({ data: { tenantId, productId: input.productId, locationId: input.locationId, quantityDelta: input.quantityDelta, reason: input.reason, reference: input.reference, performedBy } });
      return { updated, movement };
    });
    await recordAuditLog({ tenantId, actorType: 'user', actorId: performedBy, operation: 'adjust_inventory', entityType: 'inventory_record', entityId: result.updated.id, oldValue: { quantity: result.updated.quantity - input.quantityDelta }, newValue: { quantity: result.updated.quantity, movementId: result.movement.id } });
    return result;
  },

  async listInventory(tenantId: string, locationId?: string) {
    return prisma.inventoryRecord.findMany({ where: { tenantId, ...(locationId ? { locationId } : {}) }, include: { product: true, location: true }, orderBy: { updatedAt: 'desc' } });
  },

  async detectLowStock(tenantId: string, performedBy: string) {
    const policy = await this.getPolicy(tenantId);
    if (!policy.lowStockAlertsEnabled) return [];
    const inventory = await prisma.inventoryRecord.findMany({ where: { tenantId }, include: { product: true, location: true } });
    const lowStock = inventory.filter((record) => record.quantity - record.reservedQuantity <= record.product.reorderPoint);
    const alerts = [];
    for (const record of lowStock) {
      const existing = await prisma.stockAlert.findFirst({ where: { tenantId, productId: record.productId, locationId: record.locationId, status: 'open' } });
      if (existing) {
        alerts.push(existing);
        continue;
      }
      const alert = await prisma.stockAlert.create({ data: { tenantId, productId: record.productId, locationId: record.locationId, currentQuantity: record.quantity, reorderPoint: record.product.reorderPoint } });
      await recordAuditLog({ tenantId, actorType: 'user', actorId: performedBy, operation: 'create_stock_alert', entityType: 'stock_alert', entityId: alert.id, newValue: alert });
      alerts.push(alert);
    }
    return alerts;
  },

  async listAlerts(tenantId: string, status?: string) {
    return prisma.stockAlert.findMany({ where: { tenantId, ...(status ? { status } : {}) }, include: { product: true, location: true }, orderBy: { createdAt: 'desc' } });
  },

  async createReorderRecommendation(tenantId: string, input: { productId: string; locationId: string }, createdBy: string) {
    const [product, location, inventory, policy] = await Promise.all([
      prisma.product.findFirst({ where: { id: input.productId, tenantId, isActive: true } }),
      prisma.warehouseLocation.findFirst({ where: { id: input.locationId, tenantId, isActive: true } }),
      prisma.inventoryRecord.findFirst({ where: { tenantId, productId: input.productId, locationId: input.locationId } }),
      this.getPolicy(tenantId),
    ]);
    if (!product) throw new NotFoundError('Product not found');
    if (!location) throw new NotFoundError('Location not found');
    const available = (inventory?.quantity ?? 0) - (inventory?.reservedQuantity ?? 0);
    const recentMovements = await prisma.inventoryMovement.findMany({ where: { tenantId, productId: product.id, locationId: location.id, quantityDelta: { lt: 0 }, createdAt: { gte: new Date(Date.now() - 30 * 86400000) } } });
    const recentDemand = recentMovements.reduce((sum, movement) => sum + Math.abs(movement.quantityDelta), 0);
    const deficit = Math.max(product.reorderPoint - available, 0);
    const suggestedQuantity = Math.max(product.reorderQuantity, deficit, Math.ceil(recentDemand / 4));
    if (suggestedQuantity <= 0) throw new ConflictError('No reorder is required for this inventory position');
    const estimatedValue = decimal(suggestedQuantity * Number(product.unitCost));
    let operationsAgentId: string | undefined;
    if (product.supplierId && Number(estimatedValue) >= Number(policy.highValuePurchaseThreshold)) {
      const agent = await prisma.agent.findFirst({ where: { tenantId, department: 'operations', isActive: true } });
      if (!agent) throw new NotFoundError('Active operations agent not found');
      operationsAgentId = agent.id;
    }
    const recommendation = await prisma.reorderRecommendation.create({ data: { tenantId, productId: product.id, locationId: location.id, suggestedQuantity, estimatedValue, reason: `Available stock ${available} is at or below reorder point ${product.reorderPoint}`, status: 'pending', createdBy } });
    let orderId: string | undefined;
    if (product.supplierId) {
      const order = await prisma.purchaseOrder.create({ data: { tenantId, supplierId: product.supplierId, totalValue: estimatedValue, currency: product.currency, source: 'reorder_recommendation', createdBy, items: { create: [{ tenantId, productId: product.id, quantity: suggestedQuantity, unitCost: product.unitCost }] } } });
      let linked = await prisma.reorderRecommendation.update({ where: { id: recommendation.id }, data: { purchaseOrderId: order.id } });
      orderId = order.id;
      if (Number(estimatedValue) >= Number(policy.highValuePurchaseThreshold)) {
        await prisma.approvalRequest.create({ data: { tenantId, requestedByAgentId: operationsAgentId!, actionType: 'operations_purchase_order', associatedTaskId: null, actionPayload: { recommendationId: recommendation.id, orderId: order.id, estimatedValue: Number(estimatedValue) } as Prisma.InputJsonValue } });
        linked = await prisma.reorderRecommendation.update({ where: { id: recommendation.id }, data: { status: 'pending_approval' } });
      }
      await recordAuditLog({ tenantId, actorType: 'user', actorId: createdBy, operation: 'create_reorder_recommendation', entityType: 'reorder_recommendation', entityId: linked.id, newValue: { recommendation: linked, orderId } });
      return { recommendation: linked, orderId };
    }
    await recordAuditLog({ tenantId, actorType: 'user', actorId: createdBy, operation: 'create_reorder_recommendation', entityType: 'reorder_recommendation', entityId: recommendation.id, newValue: recommendation });
    return { recommendation, orderId };
  },

  async reviewReorderApproval(tenantId: string, approvalId: string, reviewerId: string, decision: 'approved' | 'rejected', rejectionReason?: string) {
    const approval = await prisma.approvalRequest.findFirst({ where: { id: approvalId, tenantId, actionType: 'operations_purchase_order' } });
    if (!approval) throw new NotFoundError('Operations approval request not found');
    if (approval.status !== 'pending') throw new ConflictError('Approval request has already been reviewed');
    const payload = approval.actionPayload as Record<string, unknown>;
    const recommendationId = typeof payload.recommendationId === 'string' ? payload.recommendationId : null;
    const orderId = typeof payload.orderId === 'string' ? payload.orderId : null;
    if (!recommendationId || !orderId) throw new ValidationError('Operations approval payload is invalid');
    const updated = await prisma.approvalRequest.update({ where: { id: approvalId }, data: { status: decision, reviewedByUserId: reviewerId, rejectionReason: decision === 'rejected' ? rejectionReason : null } });
    await prisma.reorderRecommendation.update({ where: { id: recommendationId }, data: { status: decision } });
    await prisma.purchaseOrder.update({ where: { id: orderId }, data: { status: decision } });
    await recordAuditLog({ tenantId, actorType: 'user', actorId: reviewerId, operation: `operations_purchase_${decision}`, entityType: 'purchase_order', entityId: orderId, newValue: { recommendationId, status: decision } });
    return updated;
  },

  async recordDemandSignal(tenantId: string, input: { productId: string; locationId: string; periodStart: Date; periodEnd: Date }, createdBy: string) {
    const movements = await prisma.inventoryMovement.findMany({ where: { tenantId, productId: input.productId, locationId: input.locationId, quantityDelta: { lt: 0 }, createdAt: { gte: input.periodStart, lte: input.periodEnd } } });
    const unitsMoved = movements.reduce((sum, movement) => sum + Math.abs(movement.quantityDelta), 0);
    const signal = await prisma.demandSignal.create({ data: { tenantId, productId: input.productId, locationId: input.locationId, periodStart: input.periodStart, periodEnd: input.periodEnd, unitsMoved } });
    await recordAuditLog({ tenantId, actorType: 'user', actorId: createdBy, operation: 'record_demand_signal', entityType: 'demand_signal', entityId: signal.id, newValue: signal });
    return signal;
  },
};
