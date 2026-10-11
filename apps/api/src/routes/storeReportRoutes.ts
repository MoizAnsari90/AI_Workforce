import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authMiddleware';
import { enforceTenantIsolation } from '../middleware/tenantIsolationMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import { reportSettings, saveReportSettings } from '../services/storeReportScheduler';
import { generateStoreReport } from '../services/storeReportService';
export const storeReportRouter = Router();
const base = '/tenants/:tenantId/store-reports';
storeReportRouter.use(base, authenticate, enforceTenantIsolation, requireRole('admin'));
storeReportRouter.get(base, async (req, res, next) => { try { res.json({ success: true, data: await reportSettings(req.tenantId!) }); } catch (e) { next(e); } });
storeReportRouter.put(base, async (req, res, next) => { try { res.json({ success: true, data: await saveReportSettings(req.tenantId!, req.body) }); } catch (e) { next(e); } });
storeReportRouter.get(`${base}/preview`, async (req, res, next) => {
  try {
    const { date } = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).strict().parse(req.query);
    res.json({ success: true, data: await generateStoreReport(req.tenantId!, date || 'yesterday') });
  } catch (e) { next(e); }
});
