import { Router } from 'express';
import { Receiver } from '@upstash/qstash';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env';
import { redisConnectionOptions } from '../config/redis';
import { queueService } from '../services/queueService';
import { supportAgentService } from '../services/supportAgentService';
import { tickNicheAutomation } from '../services/nicheAutomationWorker';
import { tickStoreReports } from '../services/storeReportScheduler';
import { autonomyService } from '../services/autonomyService';
import { logger } from '../utils/logger';

export const automationCallbackRouter = Router();
const leaseKey = 'ai-workforce:automation:lease';

automationCallbackRouter.post('/tick', async (req, res) => {
  if (process.env.SERVERLESS_AUTOMATION_ENABLED !== 'true' || env.BACKGROUND_WORKERS_ENABLED === 'true') {
    res.status(503).json({ error: 'Scheduled callback processing is disabled' }); return;
  }
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!currentSigningKey || !nextSigningKey || !process.env.PUBLIC_API_URL) {
    res.status(503).json({ error: 'Callback verification is not configured' }); return;
  }
  try {
    const signature = req.get('Upstash-Signature');
    if (!signature || !Buffer.isBuffer(req.body)) throw new Error();
    const valid = await new Receiver({ currentSigningKey, nextSigningKey }).verify({
      signature, body: req.body.toString('utf8'), url: `${process.env.PUBLIC_API_URL}/internal/automation/tick`,
    });
    if (!valid) throw new Error();
  } catch { res.status(401).json({ error: 'Invalid callback signature' }); return; }

  const redis = new Redis({ ...redisConnectionOptions(env), lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 5000, commandTimeout: 5000, retryStrategy: () => null });
  redis.on('error', () => {});
  const lease = randomUUID(); let owned = false;
  let status = 200; let result: Record<string, unknown> = {};
  try {
    await redis.connect();
    owned = await redis.set(leaseKey, lease, 'EX', 300, 'NX') === 'OK';
    if (!owned) result = { skipped: 'another callback is active' };
    else {
      const options = { limit: 2, deadline: Date.now() + 150000 };
      const queue = await queueService.drainOnce(async data => { await supportAgentService.processInboundMessage(data.tenantId, data.message); }, 20000, 5);
      if (Date.now() < options.deadline) await tickNicheAutomation(options);
      if (Date.now() < options.deadline) await tickStoreReports(undefined, options);
      if (Date.now() < options.deadline) await autonomyService.tick(undefined, options);
      await redis.set('ai-workforce:automation:last-run', JSON.stringify({ at: new Date().toISOString(), queueHandled: queue.handled }), 'EX', 86400);
      result = { success: true, queueHandled: queue.handled };
    }
  } catch {
    logger.error('Scheduled automation callback failed; pending work remains in durable storage');
    status = 503; result = { error: 'Automation cycle failed; retry delivery' };
  } finally {
    if (owned) await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, leaseKey, lease).catch(() => {});
    redis.disconnect();
  }
  // Finish cleanup before responding; serverless runtimes may freeze on return.
  res.status(status).json(result);
});
