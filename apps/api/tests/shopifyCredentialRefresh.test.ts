import { beforeEach, describe, it, expect, vi } from 'vitest';
import crypto from 'node:crypto';
const db = vi.hoisted(() => ({ externalIntegrationCredential: { upsert: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() } }));
vi.mock('../src/lib/prisma', () => ({ prisma: db }));
vi.mock('../src/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../src/services/auditService', () => ({ recordAuditLog: vi.fn() }));
import { IntegrationService } from '../src/services/integrationService';
const original = { shop: 'test.myshopify.com', accessToken: 'old', allowWrites: false };
beforeEach(async () => {
  vi.clearAllMocks();
  db.externalIntegrationCredential.upsert.mockResolvedValue({ id: 'row' });
  await IntegrationService.storeCredential({ tenantId: 'tenant', provider: 'shopify', config: original });
  const { encryptedConfig } = db.externalIntegrationCredential.upsert.mock.calls[0][0].create;
  db.externalIntegrationCredential.findUnique.mockResolvedValue({ id: 'row', tenantId: 'tenant', isActive: true, encryptedConfig });
  db.externalIntegrationCredential.updateMany.mockResolvedValue({ count: 1 });
});
describe('Credential renewal compare-and-swap', () => {
  it('stores credentials with authenticated AES-GCM ciphertext and rejects tampering', async () => {
    const { encryptedConfig } = db.externalIntegrationCredential.upsert.mock.calls[0][0].create;
    expect(encryptedConfig.data).toMatch(/^v2:[a-f0-9]{24}:[a-f0-9]{32}:[a-f0-9]+$/i);
    expect(JSON.stringify(encryptedConfig)).not.toContain(original.accessToken);
    const last = encryptedConfig.data.at(-1);
    db.externalIntegrationCredential.findUnique.mockResolvedValue({ id: 'row', tenantId: 'tenant', isActive: true,
      encryptedConfig: { data: encryptedConfig.data.slice(0, -1) + (last === '0' ? '1' : '0') } });
    await expect(IntegrationService.getCredential('tenant', 'shopify')).rejects.toThrow('Credential decryption failed');
  });

  it('reads legacy CBC credentials and upgrades the stored row to authenticated encryption', async () => {
    const key = crypto.createHash('sha256').update(process.env.INTEGRATION_ENCRYPTION_KEY!, 'utf8').digest();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(original), 'utf8'), cipher.final()]);
    const legacy = { data: `${iv.toString('hex')}:${encrypted.toString('hex')}` };
    db.externalIntegrationCredential.findUnique.mockResolvedValue({ id: 'row', tenantId: 'tenant', isActive: true, encryptedConfig: legacy });
    expect(await IntegrationService.getCredential('tenant', 'shopify')).toEqual(original);
    const update = db.externalIntegrationCredential.updateMany.mock.calls[0][0];
    expect(update.where).toMatchObject({ id: 'row', tenantId: 'tenant', isActive: true });
    expect(update.data.encryptedConfig.data).toMatch(/^v2:/);
  });

  it('uses the existing encrypted snapshot as an atomic condition', async () => {
    expect(await IntegrationService.replaceCredentialIfUnchanged('tenant', 'shopify', original, { ...original, accessToken: 'new' })).toBe(true);
    const update = db.externalIntegrationCredential.updateMany.mock.calls[0][0];
    expect(update.where).toMatchObject({ id: 'row', tenantId: 'tenant', isActive: true, encryptedConfig: { equals: expect.any(Object) } });
    expect(JSON.stringify(update.data)).not.toContain('"accessToken":"new"');
    expect(db.externalIntegrationCredential.upsert).toHaveBeenCalledTimes(1);
  });
  it('refuses to resurrect a removed connection', async () => {
    db.externalIntegrationCredential.findUnique.mockResolvedValue(null);
    expect(await IntegrationService.replaceCredentialIfUnchanged('tenant', 'shopify', original, original)).toBe(false);
    expect(db.externalIntegrationCredential.updateMany).not.toHaveBeenCalled();
  });
  it('refuses to overwrite a concurrently changed setting', async () => {
    expect(await IntegrationService.replaceCredentialIfUnchanged('tenant', 'shopify', { ...original, allowWrites: true }, original)).toBe(false);
    expect(db.externalIntegrationCredential.updateMany).not.toHaveBeenCalled();
  });
  it('reports a lost database race without upserting', async () => {
    db.externalIntegrationCredential.updateMany.mockResolvedValue({ count: 0 });
    expect(await IntegrationService.replaceCredentialIfUnchanged('tenant', 'shopify', original, original)).toBe(false);
    expect(db.externalIntegrationCredential.upsert).toHaveBeenCalledTimes(1);
  });
});
