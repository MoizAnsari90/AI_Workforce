import { Request, Response, NextFunction } from 'express';
import { UnauthorizedError } from '../errors/AppError';
import { resolveUserContext, verifyToken } from '../services/authService';
import { guardPaidRequest } from './subscriptionMiddleware';

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('Authentication token missing or malformed');
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token);

    // Resolve full user context including fresh permissions from DB
    const userContext = await resolveUserContext(decoded.userId, decoded.tokenVersion ?? 0);

    req.user = userContext;
    req.tenantId = userContext.tenantId;

    await guardPaidRequest(req, _res, next);
  } catch (error) {
    next(error);
  }
}
