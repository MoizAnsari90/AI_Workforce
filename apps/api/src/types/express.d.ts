import { RoleName } from '@ai-employee/shared';

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        tenantId: string;
        email: string;
        role: RoleName;
        permissions: string[];
      };
      tenantId?: string;
    }
  }
}
