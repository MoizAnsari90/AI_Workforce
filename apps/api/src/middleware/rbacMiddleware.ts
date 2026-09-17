import { Request, Response, NextFunction } from 'express';
import { RoleName } from '@ai-employee/shared';
import { ForbiddenError, UnauthorizedError } from '../errors/AppError';

export function requireRole(...allowedRoles: RoleName[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new UnauthorizedError('Authentication required'));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(
        new ForbiddenError(
          `Action requires one of the following roles: [${allowedRoles.join(', ')}]. Current role: ${req.user.role}`
        )
      );
    }

    next();
  };
}

export function requirePermission(...requiredPermissions: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new UnauthorizedError('Authentication required'));
    }

    const hasAll = requiredPermissions.every((perm) => req.user!.permissions.includes(perm));

    if (!hasAll) {
      return next(
        new ForbiddenError(
          `Missing required permissions: [${requiredPermissions.join(', ')}]`
        )
      );
    }

    next();
  };
}
