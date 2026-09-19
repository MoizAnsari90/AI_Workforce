import { prisma } from '../lib/prisma';
import { logger } from '../utils/logger';
import { recordAuditLog } from './auditService';
import crypto from 'crypto';

const ENCRYPTION_KEY = process.env.INTEGRATION_ENCRYPTION_KEY || 'default_32_byte_secret_key_change_me_12345';
const IV_LENGTH = 16;

function encrypt(text: string): string {
  // Simple AES-256-CBC encryption for credential storage security
  const key = crypto.createHash('sha256').update(String(ENCRYPTION_KEY)).digest();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text: string): string {
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
  userId?: string;
}

export class IntegrationService {
  static async storeCredential(params: StoreCredentialParams) {
    const configString = JSON.stringify(params.config);
    const encryptedConfig = { data: encrypt(configString) };

    const credential = await prisma.externalIntegrationCredential.upsert({
      where: {
        tenantId_provider: {
          tenantId: params.tenantId,
          provider: params.provider,
        },
      },
      update: {
        encryptedConfig: encryptedConfig as any,
        isActive: true,
      },
      create: {
        tenantId: params.tenantId,
        provider: params.provider,
        encryptedConfig: encryptedConfig as any,
        isActive: true,
      },
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
      const decryptedString = decrypt(encryptedObj.data);
      return JSON.parse(decryptedString);
    } catch (error) {
      logger.error('Failed to decrypt integration credential', { tenantId, provider, error: error instanceof Error ? error.message : String(error) });
      throw new Error('Credential decryption failed');
    }
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
