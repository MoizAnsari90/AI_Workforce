import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { ApiResponse } from '@ai-employee/shared';
import { AppError } from '../errors/AppError';
import { logger } from '../utils/logger';

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  const timestamp = new Date().toISOString();

  if (err instanceof AppError) {
    logger.warn(`Operational error: ${err.message}`, {
      code: err.code,
      statusCode: err.statusCode,
      path: req.originalUrl,
      method: req.method,
    });

    const response: ApiResponse = {
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
      meta: {
        timestamp,
      },
    };

    return res.status(err.statusCode).json(response);
  }

  if (err instanceof ZodError) {
    const message = err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    logger.warn(`Validation error: ${message}`, {
      path: req.originalUrl,
      issues: err.issues,
    });

    const response: ApiResponse = {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request payload',
        details: err.issues,
      },
      meta: {
        timestamp,
      },
    };

    return res.status(400).json(response);
  }

  // Unhandled / server errors
  const errorObj = err instanceof Error ? err : new Error(String(err));
  logger.error(`Unhandled server error: ${errorObj.message}`, {
    stack: errorObj.stack,
    path: req.originalUrl,
    method: req.method,
  });

  const response: ApiResponse = {
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected internal error occurred',
    },
    meta: {
      timestamp,
    },
  };

  return res.status(500).json(response);
}
