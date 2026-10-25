import crypto from 'node:crypto';
import { ServiceUnavailableError } from '../errors/AppError';

type KeySource = 'current' | 'previous';

function encryptionKey(source: KeySource): Buffer {
  const value = source === 'current'
    ? process.env.MEDICAL_DATA_ENCRYPTION_KEY
    : process.env.MEDICAL_DATA_ENCRYPTION_KEY_PREVIOUS;
  if (!value || !/^[0-9a-f]{64}$/i.test(value)) {
    throw new ServiceUnavailableError('Medical data encryption key is unavailable.');
  }
  return Buffer.from(value, 'hex');
}

function additionalData(tenantId: string) {
  return Buffer.from(`ai-workforce:medical-data:v1:${tenantId}`);
}

export function encryptMedicalData(value: unknown, tenantId: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey('current'), iv);
  cipher.setAAD(additionalData(tenantId));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return ['m1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptMedicalData<T>(envelope: string, tenantId: string): T {
  try {
    const [version, encodedIv, encodedTag, encodedContent, ...extra] = envelope.split('.');
    if (version !== 'm1' || extra.length || !encodedIv || !encodedTag || !encodedContent) throw new Error();
    const iv = Buffer.from(encodedIv, 'base64url');
    const tag = Buffer.from(encodedTag, 'base64url');
    const content = Buffer.from(encodedContent, 'base64url');
    if (iv.length !== 12 || tag.length !== 16) throw new Error();

    const keys = [process.env.MEDICAL_DATA_ENCRYPTION_KEY, process.env.MEDICAL_DATA_ENCRYPTION_KEY_PREVIOUS]
      .filter((value): value is string => !!value && /^[0-9a-f]{64}$/i.test(value));
    for (const key of keys) {
      try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
        decipher.setAAD(additionalData(tenantId));
        decipher.setAuthTag(tag);
        return JSON.parse(Buffer.concat([decipher.update(content), decipher.final()]).toString('utf8')) as T;
      } catch {
        continue;
      }
    }
    throw new Error();
  } catch {
    throw new ServiceUnavailableError('Medical data could not be decrypted. Restore the configured current or previous key.');
  }
}