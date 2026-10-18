import { Router, raw } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authenticate } from '../middleware/authMiddleware';
import { enforceTenantIsolation } from '../middleware/tenantIsolationMiddleware';
import { requirePermission } from '../middleware/rbacMiddleware';
import { AppError } from '../errors/AppError';
import { transcribeVoiceQuestion, VOICE_MAX_BYTES } from '../services/voiceQuestionService';

export const voiceQuestionRouter = Router();
const limit = rateLimit({ windowMs: 60_000, limit: 6, standardHeaders: true, legacyHeaders: false,
  keyGenerator: req => `${req.tenantId}:${req.user!.userId}`,
  message: { success: false, error: { code: 'VOICE_RATE_LIMIT', message: 'Too many voice requests. Wait a minute before trying again.' } },
});
const parse = raw({ type: 'audio/wav', limit: VOICE_MAX_BYTES, inflate: false });
voiceQuestionRouter.post('/tenants/:tenantId/workforce/transcribe', authenticate, enforceTenantIsolation, requirePermission('operations:read'), limit,
  (req, res, next) => {
    if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'audio/wav') return next(new AppError('Only WAV voice recordings are accepted.', 415, 'VOICE_FORMAT'));
    parse(req, res, error => next(error ? new AppError('Recording is too large or invalid. Please record again.', (error as { status?: number }).status === 413 ? 413 : 400, 'INVALID_VOICE_UPLOAD') : undefined));
  }, async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const parsedId = z.string().uuid().safeParse(req.headers['x-voice-request-id']);
      if (!parsedId.success) throw new AppError('Invalid voice request.', 400, 'INVALID_VOICE_REQUEST');
      const requestId = parsedId.data;
      if (!Buffer.isBuffer(req.body)) throw new AppError('Recording is invalid. Please record again.', 400, 'INVALID_VOICE_AUDIO');
      const data = await transcribeVoiceQuestion(req.tenantId!, req.user!.userId, requestId, req.body);
      res.json({ success: true, data });
    } catch (error) { next(error); }
  });
