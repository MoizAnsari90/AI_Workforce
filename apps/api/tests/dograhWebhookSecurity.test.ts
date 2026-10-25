import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { IntegrationService } from '../src/services/integrationService';
import { receiveDograhWebhook } from '../src/controllers/dograhWebhookController';
import { errorHandler } from '../src/middleware/errorHandler';

// Exercise the real credential decryption and secret check, without contacting providers.
const app = express();
app.use(express.json());
app.post('/api/webhooks/dograh/:tenantId', receiveDograhWebhook);
app.use(errorHandler);
const tenants: string[] = [];
const secrets = [randomUUID(), randomUUID()];
type CallbackOptions = { eventId?: string | null; timestamp?: string | null };
const callback = (tenantId: string, body: object, secret?: string, options: CallbackOptions = {}) => {
  const operation = request(app).post(`/api/webhooks/dograh/${tenantId}`);
  if (secret) operation.set('Authorization', `Bearer ${secret}`);
  if (options.eventId !== null) operation.set('X-Dograh-Event-Id', options.eventId ?? randomUUID());
  if (options.timestamp !== null) operation.set('X-Dograh-Timestamp', options.timestamp ?? String(Math.floor(Date.now() / 1000)));
  return operation.send(body);
};

beforeAll(async () => {
  for (const secret of secrets) {
    const tenant = await prisma.tenant.create({ data: { name: `dograh-security-${randomUUID()}` } });
    tenants.push(tenant.id);
    await IntegrationService.storeCredential({ tenantId: tenant.id, provider: 'dograh', config: {
      apiUrl: 'https://dograh.example.test', apiKey: 'fixture-api-key', agentId: 'fixture-agent', webhookSecret: secret,
    } });
  }
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: tenants } } });
  await prisma.$disconnect();
});

describe('Dograh webhook with real encrypted workspace credentials', () => {
  it('rejects missing, forged and another workspace secret before writing a session', async () => {
    const body = { tenant_id: tenants[0], call_id: randomUUID(), status: 'completed' };
    for (const secret of [undefined, 'forged', secrets[1]]) {
      expect((await callback(tenants[0], body, secret)).status).toBe(401);
    }
    expect((await callback(tenants[0], { ...body, tenant_id: tenants[1] }, secrets[0])).status).toBe(403);
    expect(await prisma.voiceSession.findUnique({ where: { callId: body.call_id } })).toBeNull();
  });

  it('rejects missing event metadata and stale timestamps before writing a session', async () => {
    const callId = randomUUID();
    expect((await callback(tenants[0], { call_id: callId, status: 'completed' }, secrets[0], { eventId: null })).status).toBe(400);
    expect((await callback(tenants[0], { call_id: callId, status: 'completed' }, secrets[0], { timestamp: null })).status).toBe(400);
    expect((await callback(tenants[0], { call_id: callId, status: 'completed' }, secrets[0], { eventId: randomUUID(), timestamp: String(Math.floor(Date.now() / 1000) - 301) })).status).toBe(401);
    expect(await prisma.voiceSession.findUnique({ where: { callId } })).toBeNull();
  });

  it('stores a completed transcript once and does not regress on a delayed started event', async () => {
    const body = { workflow_run_id: randomUUID(), status: 'completed', transcript: 'Synthetic call completed', duration: 12 };
    const resultEventId = randomUUID();
    expect((await callback(tenants[0], body, secrets[0], { eventId: resultEventId })).status).toBe(200);
    expect((await callback(tenants[0], body, secrets[0], { eventId: resultEventId })).body).toMatchObject({ replayed: true });
    expect((await callback(tenants[0], { workflow_run_id: body.workflow_run_id, event: 'call.started' }, secrets[0])).status).toBe(200);
    const rows = await prisma.voiceSession.findMany({ where: { callId: body.workflow_run_id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenantId: tenants[0], provider: 'DOGRAH', status: 'completed', transcript: [{ speaker: 'conversation', text: body.transcript }] });
  });

  it('does not let a later terminal event regress a completed call', async () => {
    const callId = randomUUID();
    expect((await callback(tenants[0], { call_id: callId, status: 'completed' }, secrets[0])).status).toBe(200);
    expect((await callback(tenants[0], { call_id: callId, status: 'failed' }, secrets[0])).status).toBe(200);
    expect(await prisma.voiceSession.findUnique({ where: { callId } })).toMatchObject({ status: 'completed' });
  });

  it('rejects reassignment of an existing call even with the second workspace valid secret', async () => {
    const callId = randomUUID();
    expect((await callback(tenants[0], { tenant_id: tenants[0], call_id: callId, status: 'completed' }, secrets[0])).status).toBe(200);
    expect((await callback(tenants[1], { tenant_id: tenants[1], call_id: callId, status: 'failed' }, secrets[1])).status).toBe(409);
    expect(await prisma.voiceSession.findUnique({ where: { callId } })).toMatchObject({ tenantId: tenants[0], status: 'completed' });
  });

  it('blocks authenticated tools while voice automation is disabled', async () => {
    const response = await callback(tenants[0], { event: 'function_call', function: { name: 'shopify_inventory_lookup', arguments: { sku: 'synthetic' } } }, secrets[0]);
    expect(response.status).toBe(409);
  });

  it('accepts unavailable recording and transcript links without clearing existing links', async () => {
    const callId = randomUUID();
    const body = { call_id: callId, status: 'completed', recording_url: null, transcript_url: null };
    expect((await callback(tenants[0], body, secrets[0])).status).toBe(200);
    const available = { ...body, recording_url: 'https://media.example.test/recording.wav', transcript_url: 'https://media.example.test/transcript.json' };
    expect((await callback(tenants[0], available, secrets[0])).status).toBe(200);
    expect((await callback(tenants[0], body, secrets[0])).status).toBe(200);
    expect((await callback(tenants[0], { ...body, recording_url: 'http://media.example.test/recording.wav' }, secrets[0])).status).toBe(400);
    expect(await prisma.voiceSession.findUnique({ where: { callId } })).toMatchObject({
      tenantId: tenants[0], status: 'completed', metadata: { recordingUrl: available.recording_url, transcriptUrl: available.transcript_url },
    });
  });
});
