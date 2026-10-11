import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import { enforceTenantIsolation } from '../middleware/tenantIsolationMiddleware';
import { getBusinessProfile, markets, saveBusinessProfile } from '../services/businessProfileService';
import { checkCalendarAvailability, disconnectGoogleCalendar, finishCalendarConnection, getCalendarStatus, selectGoogleCalendar, startCalendarConnection } from '../services/googleCalendarService';

export const businessSetupRouter = Router();
businessSetupRouter.use('/tenants/:tenantId/business-setup', authenticate, enforceTenantIsolation);
businessSetupRouter.get('/tenants/:tenantId/business-setup', async (req, res, next) => {
  try { res.json({ success: true, data: { ...await getBusinessProfile(req.tenantId!), markets } }); } catch (error) { next(error); }
});
businessSetupRouter.put('/tenants/:tenantId/business-setup', requireRole('admin'), async (req, res, next) => {
  try { res.json({ success: true, data: await saveBusinessProfile(req.tenantId!, req.user!.userId, req.body) }); } catch (error) { next(error); }
});
businessSetupRouter.use('/calendar/google', authenticate, requireRole('admin'));
businessSetupRouter.get('/calendar/google/connection', async (req, res, next) => {
  try { res.json({ success: true, data: await getCalendarStatus(req.tenantId!) }); } catch (error) { next(error); }
});
businessSetupRouter.post('/calendar/google/start', async (req, res, next) => {
  try { res.json({ success: true, data: await startCalendarConnection(req.tenantId!, req.user!.userId) }); } catch (error) { next(error); }
});
businessSetupRouter.post('/calendar/google/complete', async (req, res, next) => {
  try {
    const { code, state } = z.object({ code: z.string().min(1).max(4096), state: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict().parse(req.body);
    res.json({ success: true, data: await finishCalendarConnection(req.tenantId!, req.user!.userId, state, code) });
  } catch (error) { next(error); }
});
businessSetupRouter.put('/calendar/google/selection', async (req, res, next) => {
  try { const { calendarId } = z.object({ calendarId: z.string().min(1).max(1024) }).strict().parse(req.body); res.json({ success: true, data: await selectGoogleCalendar(req.tenantId!, calendarId) }); } catch (error) { next(error); }
});
businessSetupRouter.get('/calendar/google/availability', async (req, res, next) => {
  try {
    const { date } = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => { const parsed = new Date(value); return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && +value.slice(0, 4) >= 2020 && +value.slice(0, 4) <= 2100; }, 'Choose a valid date.') }).strict().parse(req.query);
    res.json({ success: true, data: await checkCalendarAvailability(req.tenantId!, date) });
  } catch (error) { next(error); }
});
businessSetupRouter.delete('/calendar/google/connection', async (req, res, next) => {
  try { res.json({ success: true, data: await disconnectGoogleCalendar(req.tenantId!, req.user!.userId) }); } catch (error) { next(error); }
});
