import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { getAutomationConfig } from '../services/nicheAutomationStore';
import { verifyNicheVoiceRequest } from '../services/nicheProviders';
import { processNicheTurn } from '../services/nicheConversationService';

export async function receiveNicheVoice(req: Request, res: Response, next: NextFunction) {
  try {
    const raw: unknown = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString('utf8')) : req.body;
    const input = z.object({ message: z.object({ type: z.string(), call: z.object({ id: z.string().uuid() }), toolCallList: z.array(z.object({ id: z.string().min(1).max(100), name: z.string().optional(), parameters: z.unknown().optional(), function: z.object({ name: z.string(), arguments: z.unknown() }).optional() })).max(5).optional() }) }).parse(raw);
    const tenantId = req.params.tenantId; const call = await verifyNicheVoiceRequest(tenantId, req.headers.authorization, input.message.call.id);
    if (!call) return res.status(403).json({ error: 'Invalid voice authentication or call ownership' });
    const config = await getAutomationConfig(tenantId);
    if (input.message.type === 'tool-calls') {
      if (!config?.voiceEnabled) return res.status(409).json({ error: 'Voice automation is disabled' });
      const results: { toolCallId: string; result?: string; error?: string }[] = [];
      for (const tool of input.message.toolCallList || []) {
        if ((tool.name || tool.function?.name) !== 'workforce_turn') { results.push({ toolCallId: tool.id, error: 'Unknown tool' }); continue; }
        let args = tool.parameters ?? tool.function?.arguments;
        if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = null; } }
        const parsed = z.object({ text: z.string().min(1).max(2000) }).strict().safeParse(args);
        if (!parsed.success) { results.push({ toolCallId: tool.id, error: 'Provide the customer message in text.' }); continue; }
        const result = await processNicheTurn(tenantId, { phone: call.customer.number, text: parsed.data.text, channel: 'voice', messageId: `${call.id}:${tool.id}`, receivedAt: new Date().toISOString() });
        results.push({ toolCallId: tool.id, result: JSON.stringify({ reply: result.reply || 'Automated assistance is paused. Please contact staff.', handoff: result.paused }) });
      }
      return res.json({ results });
    }
    const existing = await prisma.voiceSession.findUnique({ where: { callId: call.id } });
    if (existing && existing.tenantId !== tenantId) return res.status(403).json({ error: 'Call belongs to another workspace' });
    const status = call.status === 'ended' ? 'completed' : call.status || 'active';
    await prisma.voiceSession.upsert({ where: { callId: call.id }, create: { tenantId, provider: 'VAPI', callId: call.id, status }, update: { status } });
    await prisma.nicheDispatch.updateMany({ where: { tenantId, providerId: call.id, type: 'voice_call' }, data: { status: call.status === 'ended' ? 'completed' : 'accepted' } });
    return res.json({ accepted: true });
  } catch (error) { next(error); }
}
