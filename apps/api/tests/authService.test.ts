import { describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { generateToken } from '../src/services/authService';

describe('Authentication token claims', () => {
  it('starts each user session at token version zero', () => {
    const token = generateToken({
      userId: 'user-a',
      tenantId: 'tenant-a',
      email: 'user@example.test',
      role: 'admin',
    });

    expect(jwt.decode(token)).toMatchObject({ userId: 'user-a', tokenVersion: 0 });
  });
});