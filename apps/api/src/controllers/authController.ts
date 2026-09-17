import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ApiResponse } from '@ai-employee/shared';
import { login, registerTenantAndAdmin, resolveUserContext } from '../services/authService';

const registerSchema = z.object({
  tenantName: z.string().min(2, 'Tenant name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export async function handleRegister(req: Request, res: Response, next: NextFunction) {
  try {
    const validated = registerSchema.parse(req.body);
    const result = await registerTenantAndAdmin(validated);

    const response: ApiResponse<typeof result> = {
      success: true,
      data: result,
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    res.status(201).json(response);
  } catch (error) {
    next(error);
  }
}

export async function handleLogin(req: Request, res: Response, next: NextFunction) {
  try {
    const validated = loginSchema.parse(req.body);
    const result = await login(validated);

    const response: ApiResponse<typeof result> = {
      success: true,
      data: result,
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
}

export async function handleGetMe(req: Request, res: Response, next: NextFunction) {
  try {
    const userContext = await resolveUserContext(req.user!.userId);

    const response: ApiResponse<typeof userContext> = {
      success: true,
      data: userContext,
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
}
