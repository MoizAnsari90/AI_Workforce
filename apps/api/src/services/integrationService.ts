import { isDeepStrictEqual } from 'node:util';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../utils/logger';
import { recordAuditLog } from './auditService';
import crypto from 'crypto';

const ENCRYPTION_KEY = process.env.INTEGRATION_ENCRYPTION_KEY;
const IV_LENGTH = 16;

function encrypt(text: string): string {
  if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 32) throw new Error('Set INTEGRATION_ENCRYPTION_KEY to a private random value of at least 32 characters');
  // Simple AES-256-CBC encryption for credential storage security
  const key = crypto.createHash('sha256').update(String(ENCRYPTION_KEY)).digest();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text: string): string {
  if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 32) throw new Error('Set INTEGRATION_ENCRYPTION_KEY to a private random value of at least 32 characters');
  const parts = text.split(':');
  const iv = Buffer.from(parts.shift()!, 'hex');
  const encryptedText = parts.join(':');
  const key = crypto.createHash('sha256').update(String(ENCRYPTION_KEY)).digest();
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
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
      update: { encryptedConfig: encryptedConfig as any, isActive: true },
      create: { tenantId: params.tenantId, provider: params.provider, encryptedConfig: encryptedConfig as any, isActive: true },
    });
    if (params.externalAccountId) {
      await prisma.$executeRaw`UPDATE external_integration_credentials SET external_account_id = ${params.externalAccountId} WHERE id = ${credential.id} AND tenant_id = ${params.tenantId}`;
    }

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
      const decryptedString = decrypt(encryptedObj.data);
      return JSON.parse(decryptedString);
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
    if (!isDeepStrictEqual(JSON.parse(decrypt(encrypted.data)), expected)) return false;
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
