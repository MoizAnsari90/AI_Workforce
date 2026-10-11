import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import { enforceTenantIsolation } from '../middleware/tenantIsolationMiddleware';
import { createAppointment, createClinicService, createNicheResource, createProperty, dateInput, nicheAvailability, nicheKind, nicheOverview, saveNicheLead, setNicheActive, syncAppointment } from '../services/nicheWorkflowService';

export const nicheWorkflowRouter = Router();
const base = '/tenants/:tenantId/bundles/:kind';
// Contact records are admin-only until dedicated clinic/staff permissions are configured.
nicheWorkflowRouter.use(base, authenticate, enforceTenantIsolation, requireRole('admin'));
nicheWorkflowRouter.get(base, async (req, res, next) => {
  try { res.json({ success: true, data: await nicheOverview(req.tenantId!, req.user!.userId, nicheKind.parse(req.params.kind)) }); } catch (error) { next(error); }
});
nicheWorkflowRouter.post(`${base}/resources`, async (req, res, next) => {
  try { res.status(201).json({ success: true, data: await createNicheResource(req.tenantId!, req.user!.userId, nicheKind.parse(req.params.kind), req.body) }); } catch (error) { next(error); }
});
nicheWorkflowRouter.post(`${base}/services`, async (req, res, next) => {
  try { z.literal('healthcare').parse(req.params.kind); res.status(201).json({ success: true, data: await createClinicService(req.tenantId!, req.user!.userId, req.body) }); } catch (error) { next(error); }
});
nicheWorkflowRouter.post(`${base}/properties`, async (req, res, next) => {
  try { z.literal('real_estate').parse(req.params.kind); res.status(201).json({ success: true, data: await createProperty(req.tenantId!, req.user!.userId, req.body) }); } catch (error) { next(error); }
});
nicheWorkflowRouter.post(`${base}/leads`, async (req, res, next) => {
  try { z.literal('real_estate').parse(req.params.kind); res.status(201).json({ success: true, data: await saveNicheLead(req.tenantId!, req.user!.userId, req.body) }); } catch (error) { next(error); }
});
nicheWorkflowRouter.put(`${base}/leads/:id`, async (req, res, next) => {
  try { z.literal('real_estate').parse(req.params.kind); res.json({ success: true, data: await saveNicheLead(req.tenantId!, req.user!.userId, req.body, z.string().uuid().parse(req.params.id)) }); } catch (error) { next(error); }
});
nicheWorkflowRouter.patch(`${base}/:collection/:id`, async (req, res, next) => {
  try { const { active } = z.object({ active: z.boolean() }).strict().parse(req.body); res.json({ success: true, data: await setNicheActive(req.tenantId!, req.user!.userId, nicheKind.parse(req.params.kind), z.enum(['resources', 'services', 'properties']).parse(req.params.collection), z.string().uuid().parse(req.params.id), active) }); } catch (error) { next(error); }
});
nicheWorkflowRouter.get(`${base}/availability`, async (req, res, next) => {
  try { const query = z.object({ resourceId: z.string().uuid(), serviceId: z.string().uuid().optional(), date: dateInput }).strict().parse(req.query); const { connectionId: _connection, ...data } = await nicheAvailability(req.tenantId!, nicheKind.parse(req.params.kind), query.resourceId, query.date, query.serviceId); res.json({ success: true, data }); } catch (error) { next(error); }
});
nicheWorkflowRouter.post(`${base}/appointments`, async (req, res, next) => {
  try { const data = await createAppointment(req.tenantId!, req.user!.userId, nicheKind.parse(req.params.kind), req.body); res.status(['sync_pending', 'cancel_pending'].includes(data.status) ? 202 : 200).json({ success: true, data }); } catch (error) { next(error); }
});
nicheWorkflowRouter.post(`${base}/appointments/:id/:action`, async (req, res, next) => {
  try { const action = z.enum(['sync', 'cancel']).parse(req.params.action); const data = await syncAppointment(req.tenantId!, req.user!.userId, nicheKind.parse(req.params.kind), z.string().uuid().parse(req.params.id), action === 'cancel'); res.status(['sync_pending', 'cancel_pending'].includes(data.status) ? 202 : 200).json({ success: true, data }); } catch (error) { next(error); }
});
