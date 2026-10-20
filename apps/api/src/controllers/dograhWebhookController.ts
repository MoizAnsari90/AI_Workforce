import type { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { processNicheTurn } from '../services/nicheConversationService';
import { getDograhCredential, verifyDograhWebhookSecret } from '../services/dograh';
import { logger } from '../utils/logger';
import { getAutomationConfig } from '../services/nicheAutomationStore';
import { ShopifyTool } from '../tools/shopifyTool';
import { checkCalendarAvailability } from '../services/googleCalendarService';

const httpsUrl = z.string().url().refine(value => new URL(value).protocol === 'https:');

const payloadSchema = z.object({
  event: z.string().max(100).optional(),
  type: z.string().max(100).optional(),
  tenant_id: z.string().uuid().optional(),
  tenantId: z.string().uuid().optional(),
  call_id: z.union([z.string().min(1).max(200), z.number().int().positive()]).optional(),
  workflow_run_id: z.union([z.string().min(1).max(200), z.number().int().positive()]).optional(),
  status: z.string().max(100).optional(),
  duration: z.union([z.string(), z.number()]).optional(),
  duration_seconds: z.union([z.string(), z.number()]).optional(),
  transcript: z.unknown().optional(),
  transcript_text: z.string().max(100_000).optional(),
  recording_url: httpsUrl.optional(),
  transcript_url: httpsUrl.optional(),
  initial_context: z.record(z.string(), z.unknown()).optional(),
  gathered_context: z.record(z.string(), z.unknown()).optional(),
  cost_info: z.object({ call_duration_seconds: z.union([z.string(), z.number()]).optional() }).passthrough().optional(),
  function: z.object({ name: z.string().max(100), arguments: z.unknown().optional() }).optional(),
  function_call: z.object({ name: z.string().max(100), arguments: z.unknown().optional() }).optional(),
  tool: z.object({ name: z.string().max(100), arguments: z.unknown().optional() }).optional(),
  parameters: z.unknown().optional(),
  customer_phone: z.string().max(32).optional(),
  phone_number: z.string().max(32).optional(),
  request_id: z.string().min(1).max(200).optional(),
  tool_call_id: z.string().min(1).max(200).optional(),
}).passthrough();

function transcriptValue(payload: z.infer<typeof payloadSchema>) {
  const raw = payload.transcript ?? payload.transcript_text;
  if (typeof raw === 'string') return [{ speaker: 'conversation', text: raw }];
  if (Array.isArray(raw)) return raw.map(item => {
    if (item && typeof item === 'object') {
      const row = item as Record<string, unknown>;
      return { speaker: String(row.speaker ?? row.role ?? 'conversation'), text: String(row.text ?? row.content ?? '') };
    }
    return { speaker: 'conversation', text: String(item) };
  });
  if (raw && typeof raw === 'object' && Array.isArray((raw as { messages?: unknown }).messages)) {
    return transcriptValue({ transcript: (raw as { messages: unknown[] }).messages } as z.infer<typeof payloadSchema>);
  }
  if (raw !== undefined) return [{ speaker: 'conversation', text: JSON.stringify(raw).slice(0, 100_000) }];
  return undefined;
}
export async function receiveDograhWebhook(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = payloadSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid Dograh webhook payload' });
    const payload = parsed.data;
    const tenantId = payload.tenant_id || payload.tenantId || payload.initial_context?.tenant_id;
    if (typeof tenantId !== 'string') return res.status(400).json({ error: 'tenant_id is required' });
    const credential = await getDograhCredential(tenantId);
    const auth = req.get('authorization') || req.get('x-dograh-webhook-secret') || undefined;
    if (!verifyDograhWebhookSecret(credential.webhookSecret, auth)) return res.status(401).json({ error: 'Invalid Dograh webhook credentials' });

    const functionCall = payload.function_call || payload.function || payload.tool;
    const event = (payload.event || payload.type || '').toLowerCase();
    if (event === 'function_call' || functionCall) {
      const automation = await getAutomationConfig(tenantId);
      if (!automation?.voiceEnabled) return res.status(409).json({ error: 'Voice automation is disabled for this workspace' });
      if (!functionCall) return res.status(400).json({ error: 'Dograh function name is required' });
      const rawArgs = functionCall.arguments ?? payload.parameters;
      const args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
      if (functionCall.name === 'workforce_turn') {
        const input = z.object({ text: z.string().trim().min(1).max(2000), phone: z.string().min(7).max(32).optional() }).strict().parse(args);
        const phone = input.phone || payload.customer_phone || payload.phone_number || String(payload.initial_context?.phone_number || '');
        if (!phone) return res.status(400).json({ error: 'A customer phone number is required for this Dograh tool call' });
        const requestId = payload.tool_call_id || payload.request_id;
        if (!requestId) return res.status(400).json({ error: 'request_id or tool_call_id is required for idempotent workforce actions' });
        const callId = payload.workflow_run_id || payload.call_id || 'unknown-call';
        const requestKey = crypto.createHash('sha256').update(`${callId}:${requestId}`).digest('hex');
        const result = await processNicheTurn(tenantId, { phone, text: input.text, channel: 'voice', messageId: `dograh:${requestKey}`, receivedAt: new Date().toISOString() });
        return res.status(200).json({ result: { reply: result.reply || 'Please contact the business team for assistance.', handoff: result.paused } });
      }
      if (functionCall.name === 'shopify_inventory_lookup') {
        const input = z.object({ sku: z.string().trim().min(1).max(255) }).strict().parse(args);
        return res.status(200).json({ result: await ShopifyTool.checkStock(tenantId, input) });
      }
      if (functionCall.name === 'google_calendar_availability') {
        const input = z.object({ date: z.iso.date() }).strict().parse(args);
        return res.status(200).json({ result: await checkCalendarAvailability(tenantId, input.date) });
      }
      return res.status(400).json({ error: 'Unsupported Dograh tool. Allowed tools: workforce_turn, shopify_inventory_lookup, google_calendar_availability.' });
    }

    const callId = payload.call_id ?? payload.workflow_run_id;
    if (callId === undefined) return res.status(400).json({ error: 'call_id or workflow_run_id is required' });
    const id = String(callId);
    const statusValue = `${payload.status || payload.gathered_context?.call_status || event}`.toLowerCase();
    let status = ['started', 'initiated', 'in_progress', 'active', 'call.started'].includes(statusValue)
      ? 'active'
      : ['ended', 'completed', 'success', 'call.ended'].includes(statusValue) ? 'completed'
        : ['failed', 'error', 'no_answer', 'busy', 'cancelled'].includes(statusValue) ? 'failed' : 'completed';
    const existing = await prisma.voiceSession.findUnique({ where: { callId: id } });
    if (existing && existing.tenantId !== tenantId) return res.status(409).json({ error: 'Dograh call is already associated with another workspace' });
    if (existing && ['completed', 'failed'].includes(existing.status) && status === 'active') status = existing.status;
    const metadata = {
      ...(existing?.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata) ? existing.metadata as Record<string, unknown> : {}),
      event: payload.event || payload.type || null,
      durationSeconds: Number(payload.duration_seconds ?? payload.duration ?? payload.cost_info?.call_duration_seconds) || (existing?.metadata && typeof existing.metadata === 'object' ? (existing.metadata as Record<string, unknown>).durationSeconds : null),
      ...(payload.recording_url ? { recordingUrl: payload.recording_url } : {}),
      ...(payload.transcript_url ? { transcriptUrl: payload.transcript_url } : {}),
      ...(payload.initial_context ? { initialContext: payload.initial_context } : {}),
      ...(payload.gathered_context ? { gatheredContext: payload.gathered_context } : {}),
    };
    await prisma.voiceSession.upsert({
      where: { callId: id },
      create: { tenantId, provider: 'DOGRAH', callId: id, status, transcript: transcriptValue(payload) as object | undefined, metadata: metadata as Prisma.InputJsonValue },
      update: { status, ...(transcriptValue(payload) !== undefined ? { transcript: transcriptValue(payload) as object } : {}), metadata: metadata as Prisma.InputJsonValue },
    });
    await prisma.nicheDispatch.updateMany({ where: { tenantId, providerId: id, type: 'voice_call' }, data: { status: status === 'completed' || status === 'failed' ? status : 'accepted' } });
    return res.status(200).json({ received: true, call_id: id });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid Dograh webhook payload' });
    logger.warn('Dograh webhook could not be persisted', { error: error instanceof Error ? error.message : String(error) });
    return next(error);
  }
}

\n