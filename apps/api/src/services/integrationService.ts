import { isDeepStrictEqual } from 'node:util';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../utils/logger';
import { recordAuditLog } from './auditService';
import crypto from 'crypto';

const ENCRYPTION_VERSION = 'v2';
const GCM_IV_LENGTH = 12;

function encryptionKey(): Buffer {
  const value = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!value || value.length < 32) throw new Error('Set INTEGRATION_ENCRYPTION_KEY to a private random value of at least 32 characters');
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

function encrypt(text: string): string {
  const iv = crypto.randomBytes(GCM_IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return [ENCRYPTION_VERSION, iv.toString('hex'), cipher.getAuthTag().toString('hex'), encrypted.toString('hex')].join(':');
}

function decrypt(text: string): { plaintext: string; legacy: boolean } {
  const key = encryptionKey();
  const parts = text.split(':');
  if (parts[0] === ENCRYPTION_VERSION) {
    if (parts.length !== 4 || !/^[a-f0-9]{24}$/i.test(parts[1]) || !/^[a-f0-9]{32}$/i.test(parts[2]) || !/^(?:[a-f0-9]{2})+$/i.test(parts[3])) {
      throw new Error('Invalid encrypted credential format');
    }
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1], 'hex'));
    decipher.setAuthTag(Buffer.from(parts[2], 'hex'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(parts[3], 'hex')), decipher.final()]).toString('utf8');
    return { plaintext, legacy: false };
  }

  // Read old CBC records during rollout, then transparently re-encrypt them as authenticated GCM.
  if (parts.length !== 2 || !/^[a-f0-9]{32}$/i.test(parts[0]) || !/^(?:[a-f0-9]{2})+$/i.test(parts[1])) {
    throw new Error('Invalid encrypted credential format');
  }
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(parts[0], 'hex'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(parts[1], 'hex')), decipher.final()]).toString('utf8');
  return { plaintext, legacy: true };
}

export interface StoreCredentialParams {
  tenantId: string;
  provider: string; // 'shopify', 'quickbooks', 'crm', 'vapi', 'retell'
  config: Record<string, unknown>;
  externalAccountId?: string;
  userId?: string;
}

export class IntegrationService {
  static async getWhatsAppCredential(tenantId: string): Promise<{ accessToken?: string; phoneNumberId?: string }> {
    const connected = await this.getCredential(tenantId, 'whatsapp');
    if (typeof connected?.accessToken === 'string' && typeof connected.phoneNumberId === 'string') {
      return { accessToken: connected.accessToken, phoneNumberId: connected.phoneNumberId };
    }
    // Keep existing workspaces working while they migrate from the legacy settings form.
    const legacy = await prisma.business.findFirst({ where: { tenantId }, select: { supportAccessToken: true, supportPhoneNumberId: true } });
    return { accessToken: legacy?.supportAccessToken ?? undefined, phoneNumberId: legacy?.supportPhoneNumberId ?? undefined };
  }

  static async storeCredential(params: StoreCredentialParams) {
    const configString = JSON.stringify(params.config);
    const encryptedConfig = { data: encrypt(configString) };

    const credential = await prisma.externalIntegrationCredential.upsert({
      where: { tenantId_provider: { tenantId: params.tenantId, provider: params.provider } },
      update: { encryptedConfig: encryptedConfig as any, isActive: true, ...(params.externalAccountId ? { externalAccountId: params.externalAccountId } : {}) },
      create: { tenantId: params.tenantId, provider: params.provider, encryptedConfig: encryptedConfig as any, isActive: true, externalAccountId: params.externalAccountId },
    });

    if (params.userId) {
      await recordAuditLog({
        tenantId: params.tenantId,
        actorType: 'user',
        actorId: params.userId,
        operation: 'store_integration_credential',
        entityType: 'external_integration_credential',
        entityId: credential.id,
        newValue: { provider: params.provider },
      });
    }

    logger.info('External integration credential stored securely', { tenantId: params.tenantId, provider: params.provider });
    return credential;
  }

  static async getCredential(tenantId: string, provider: string): Promise<Record<string, unknown> | null> {
    const credential = await prisma.externalIntegrationCredential.findUnique({
      where: {
        tenantId_provider: {
          tenantId,
          provider,
        },
      },
    });

    if (!credential || !credential.isActive) {
      return null;
    }

    try {
      const encryptedObj = credential.encryptedConfig as { data: string };
      const decrypted = decrypt(encryptedObj.data);
      const config = JSON.parse(decrypted.plaintext) as Record<string, unknown>;
      if (decrypted.legacy) {
        try {
          await prisma.externalIntegrationCredential.updateMany({
            where: { id: credential.id, tenantId, isActive: true, encryptedConfig: { equals: credential.encryptedConfig as Prisma.InputJsonValue } },
            data: { encryptedConfig: { data: encrypt(JSON.stringify(config)) } },
          });
        } catch (migrationError) {
          logger.warn('Legacy integration credential encryption upgrade deferred', { tenantId, provider, error: migrationError instanceof Error ? migrationError.message : String(migrationError) });
        }
      }
      return config;
    } catch (error) {
      logger.error('Failed to decrypt integration credential', { tenantId, provider, error: error instanceof Error ? error.message : String(error) });
      throw new Error('Credential decryption failed');
    }
  }

  // Compare the decrypted snapshot, then atomically update the same encrypted row.
  // Renewal must not recreate a disconnected integration or overwrite a new setting.
  static async replaceCredentialIfUnchanged(tenantId: string, provider: string, expected: Record<string, unknown>, config: Record<string, unknown>): Promise<boolean> {
    const current = await prisma.externalIntegrationCredential.findUnique({
      where: { tenantId_provider: { tenantId, provider } },
    });
    if (!current?.isActive) return false;
    const encrypted = current.encryptedConfig as { data: string };
    if (!isDeepStrictEqual(JSON.parse(decrypt(encrypted.data).plaintext), expected)) return false;
    const updated = await prisma.externalIntegrationCredential.updateMany({
      where: { id: current.id, tenantId, isActive: true, encryptedConfig: { equals: current.encryptedConfig as Prisma.InputJsonValue } },
      data: { encryptedConfig: { data: encrypt(JSON.stringify(config)) } },
    });
    return updated.count === 1;
  }

  static async deleteCredential(tenantId: string, provider: string, userId?: string) {
    const credential = await prisma.externalIntegrationCredential.findUnique({
      where: {
        tenantId_provider: { tenantId, provider },
      },
    });

    if (!credential) {
      return false;
    }

    await prisma.externalIntegrationCredential.delete({
      where: { id: credential.id },
    });

    if (userId) {
      await recordAuditLog({
        tenantId,
        actorType: 'user',
        actorId: userId,
        operation: 'delete_integration_credential',
        entityType: 'external_integration_credential',
        entityId: credential.id,
        oldValue: { provider },
      });
    }

    logger.info('External integration credential deleted', { tenantId, provider });
    return true;
  }
}
