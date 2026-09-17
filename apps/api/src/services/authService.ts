import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { JWTPayload, RoleDefaultPermissions, RoleName, StandardRoles } from '@ai-employee/shared';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { ConflictError, NotFoundError, UnauthorizedError } from '../errors/AppError';
import { recordAuditLog } from './auditService';
import { logger } from '../utils/logger';

const BCRYPT_SALT_ROUNDS = 10;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateToken(payload: JWTPayload): string {
  return jwt.sign(
    {
      userId: payload.userId,
      tenantId: payload.tenantId,
      email: payload.email,
      role: payload.role,
    },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] }
  );
}

export function verifyToken(token: string): JWTPayload {
  try {
    return jwt.verify(token, env.JWT_SECRET) as JWTPayload;
  } catch (error) {
    throw new UnauthorizedError('Invalid or expired authentication token');
  }
}

export async function seedTenantRolesAndPermissions(tenantId: string) {
  // 1. Ensure all standard permissions exist in the permissions table
  const allPermissions = new Set<string>();
  Object.values(RoleDefaultPermissions).forEach((perms) => {
    perms.forEach((p) => allPermissions.add(p));
  });

  await prisma.permission.createMany({
    data: Array.from(allPermissions).map((name) => ({
      name,
      description: `Permission for ${name}`,
    })),
    skipDuplicates: true,
  });

  const allDbPerms = await prisma.permission.findMany();
  const permMap = new Map<string, string>(allDbPerms.map((p) => [p.name, p.id]));

  // 2. Create roles for this tenant and map role_permissions
  const createdRoles: Record<RoleName, { id: string; name: string }> = {} as any;

  for (const [roleName, defaultPerms] of Object.entries(RoleDefaultPermissions)) {
    const role = await prisma.role.upsert({
      where: {
        tenantId_name: {
          tenantId,
          name: roleName,
        },
      },
      update: {},
      create: {
        tenantId,
        name: roleName,
        description: `Standard ${roleName} role for tenant`,
      },
    });

    createdRoles[roleName as RoleName] = role;

    // Map permissions in batch with skipDuplicates
    const rolePermData = defaultPerms
      .map((permName) => {
        const permId = permMap.get(permName);
        return permId ? { roleId: role.id, permissionId: permId } : null;
      })
      .filter((item): item is { roleId: string; permissionId: string } => item !== null);

    if (rolePermData.length > 0) {
      await prisma.rolePermission.createMany({
        data: rolePermData,
        skipDuplicates: true,
      });
    }
  }

  return createdRoles;
}

export interface RegisterInput {
  tenantName: string;
  email: string;
  password: string;
}

export async function registerTenantAndAdmin(input: RegisterInput) {
  const existingUser = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase() },
  });

  if (existingUser) {
    throw new ConflictError('User with this email already exists');
  }

  const passwordHash = await hashPassword(input.password);

  // Use transaction to ensure complete tenant initialization
  const result = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        name: input.tenantName,
      },
    });

    const user = await tx.user.create({
      data: {
        tenantId: tenant.id,
        email: input.email.toLowerCase(),
        passwordHash,
      },
    });

    return { tenant, user };
  });

  // Seed roles & permissions
  const roles = await seedTenantRolesAndPermissions(result.tenant.id);

  // Assign admin role to the newly registered user
  await prisma.userRole.create({
    data: {
      userId: result.user.id,
      roleId: roles.admin.id,
    },
  });

  // Record audit log for registration
  await recordAuditLog({
    tenantId: result.tenant.id,
    actorType: 'user',
    actorId: result.user.id,
    operation: 'register_tenant',
    entityType: 'tenant',
    entityId: result.tenant.id,
    newValue: { tenantName: result.tenant.name, adminEmail: result.user.email },
  });

  const token = generateToken({
    userId: result.user.id,
    tenantId: result.tenant.id,
    email: result.user.email,
    role: StandardRoles.ADMIN,
  });

  logger.info('Tenant and admin registered successfully', {
    tenantId: result.tenant.id,
    userId: result.user.id,
  });

  return {
    token,
    tenant: {
      id: result.tenant.id,
      name: result.tenant.name,
      stripeSubscriptionStatus: result.tenant.stripeSubscriptionStatus,
    },
    user: {
      id: result.user.id,
      email: result.user.email,
      role: StandardRoles.ADMIN,
      permissions: RoleDefaultPermissions.admin,
    },
  };
}

export interface LoginInput {
  email: string;
  password: string;
}

export async function login(input: LoginInput) {
  const user = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase() },
    include: {
      tenant: true,
      userRoles: {
        include: {
          role: {
            include: {
              rolePermissions: {
                include: {
                  permission: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!user) {
    throw new UnauthorizedError('Invalid email or password');
  }

  const isPasswordValid = await comparePassword(input.password, user.passwordHash);
  if (!isPasswordValid) {
    throw new UnauthorizedError('Invalid email or password');
  }

  // Aggregate user role and permissions
  const primaryRole = (user.userRoles[0]?.role.name as RoleName) || StandardRoles.AGENT;
  const permissionsSet = new Set<string>();
  user.userRoles.forEach((ur) => {
    ur.role.rolePermissions.forEach((rp) => {
      permissionsSet.add(rp.permission.name);
    });
  });
  const permissions = Array.from(permissionsSet);

  const token = generateToken({
    userId: user.id,
    tenantId: user.tenantId,
    email: user.email,
    role: primaryRole,
  });

  await recordAuditLog({
    tenantId: user.tenantId,
    actorType: 'user',
    actorId: user.id,
    operation: 'user_login',
    entityType: 'user',
    entityId: user.id,
  });

  return {
    token,
    tenant: {
      id: user.tenant.id,
      name: user.tenant.name,
      stripeSubscriptionStatus: user.tenant.stripeSubscriptionStatus,
    },
    user: {
      id: user.id,
      email: user.email,
      role: primaryRole,
      permissions,
    },
  };
}

export async function resolveUserContext(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      tenant: true,
      userRoles: {
        include: {
          role: {
            include: {
              rolePermissions: {
                include: {
                  permission: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!user) {
    throw new NotFoundError('User not found');
  }

  const primaryRole = (user.userRoles[0]?.role.name as RoleName) || StandardRoles.AGENT;
  const permissionsSet = new Set<string>();
  user.userRoles.forEach((ur) => {
    ur.role.rolePermissions.forEach((rp) => {
      permissionsSet.add(rp.permission.name);
    });
  });

  return {
    userId: user.id,
    tenantId: user.tenantId,
    email: user.email,
    role: primaryRole,
    permissions: Array.from(permissionsSet),
  };
}
