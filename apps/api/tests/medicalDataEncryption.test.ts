import { afterEach, describe, expect, it, vi } from 'vitest';
import { decryptMedicalData, encryptMedicalData } from '../src/services/medicalDataEncryption';

const currentKey = '11'.repeat(32);
const rotatedKey = '22'.repeat(32);
afterEach(() => vi.unstubAllEnvs());

describe('Medical Data encryption', () => {
  it('uses a versioned AES-GCM envelope and round-trips tenant-bound data', () => {
    vi.stubEnv('MEDICAL_DATA_ENCRYPTION_KEY', currentKey);
    vi.stubEnv('MEDICAL_DATA_ENCRYPTION_KEY_PREVIOUS', '');
    const value = { name: 'Synthetic Patient', phone: '+15550000001' };
    const encrypted = encryptMedicalData(value, 'tenant-a');
    expect(encrypted.startsWith('m1.')).toBe(true);
    expect(encrypted).not.toContain(value.name);
    expect(encrypted).not.toContain(value.phone);
    expect(decryptMedicalData<typeof value>(encrypted, 'tenant-a')).toEqual(value);
  });

  it('decrypts with the previous key after rotation while encrypting with the current key', () => {
    vi.stubEnv('MEDICAL_DATA_ENCRYPTION_KEY', currentKey);
    vi.stubEnv('MEDICAL_DATA_ENCRYPTION_KEY_PREVIOUS', '');
    const oldEnvelope = encryptMedicalData({ patient: 'Synthetic' }, 'tenant-a');

    vi.stubEnv('MEDICAL_DATA_ENCRYPTION_KEY', rotatedKey);
    vi.stubEnv('MEDICAL_DATA_ENCRYPTION_KEY_PREVIOUS', currentKey);
    expect(decryptMedicalData(oldEnvelope, 'tenant-a')).toEqual({ patient: 'Synthetic' });
    expect(encryptMedicalData({ patient: 'Synthetic' }, 'tenant-a')).not.toBe(oldEnvelope);
  });

  it('fails closed on key or tenant mismatch without echoing protected data', () => {
    vi.stubEnv('MEDICAL_DATA_ENCRYPTION_KEY', currentKey);
    vi.stubEnv('MEDICAL_DATA_ENCRYPTION_KEY_PREVIOUS', '');
    const encrypted = encryptMedicalData({ patient: 'Synthetic Patient' }, 'tenant-a');
    vi.stubEnv('MEDICAL_DATA_ENCRYPTION_KEY', rotatedKey);

    const outcomes = [
      () => decryptMedicalData(encrypted, 'tenant-a'),
      () => decryptMedicalData(encrypted, 'tenant-b'),
    ].map(operation => {
      try { operation(); return false; }
      catch (error) { return error instanceof Error && !error.message.includes('Synthetic Patient'); }
    });

    expect(outcomes).toEqual([true, true]);
  });
});