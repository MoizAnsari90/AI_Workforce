import { Request, Response, NextFunction } from 'express';
import { TenantMismatchError, UnauthorizedError } from '../errors/AppError';
import { logger } from '../utils/logger';

export function enforceTenantIsolation(req: Request, _res: Response, next: NextFunction) {
  if (!req.user || !req.tenantId) {
    return next(new UnauthorizedError('Tenant context missing from authenticated request'));
  }

  const authenticatedTenantId = req.tenantId;

  // 1. Check path parameter: /api/v1/tenants/:tenantId/...
  const paramTenantId = req.params.tenantId;
  if (paramTenantId && paramTenantId !== authenticatedTenantId) {
    logger.warn('Tenant boundary violation detected in path param', {
      authenticatedTenantId,
      attemptedTenantId: paramTenantId,
      path: req.originalUrl,
      userId: req.user.userId,
    });
    return next(new TenantMismatchError(`Cannot access resources belonging to tenant ${paramTenantId}`));
  }

  // 2. Check query string: ?tenantId=...
  const queryTenantId = req.query.tenantId as string | undefined;
  if (queryTenantId && queryTenantId !== authenticatedTenantId) {
    logger.warn('Tenant boundary violation detected in query param', {
      authenticatedTenantId,
      attemptedTenantId: queryTenantId,
      path: req.originalUrl,
      userId: req.user.userId,
    });
    return next(new TenantMismatchError(`Cannot access resources belonging to tenant ${queryTenantId}`));
  }

  // 3. Check request body: { tenantId: "..." }
  if (req.body && typeof req.body === 'object' && req.body.tenantId) {
    if (req.body.tenantId !== authenticatedTenantId) {
      logger.warn('Tenant boundary violation detected in request body', {
        authenticatedTenantId,
        attemptedTenantId: req.body.tenantId,
        path: req.originalUrl,
        userId: req.user.userId,
      });
      return next(new TenantMismatchError(`Cannot mutate resources for tenant ${req.body.tenantId}`));
    }
  }

  next();
}
