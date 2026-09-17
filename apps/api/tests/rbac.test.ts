import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { hashPassword, generateToken } from '../src/services/authService';
import { StandardRoles } from '@ai-employee/shared';

describe('Server-Side RBAC Enforcement', () => {
  let adminTokenA = '';
  let adminTokenB = '';
  let agentTokenA = '';
  let viewerTokenA = '';
  let tenantAId = '';
  let tenantBId = '';
  let adminAUserId = '';
  let viewerAUserId = '';
  let conversationAId = '';
  let leadAId = '';

  beforeAll(async () => {
    // ─── Tenant A ────────────────────────────────────────────────────────
    const adminAEmail = `rbac-admina-${Date.now()}@example.com`;
    const regA = await request(app)
      .post('/api/v1/auth/register')
      .send({
        tenantName: 'RBAC Tenant A',
        email: adminAEmail,
        password: 'Password123!',
      });
    adminTokenA = regA.body.data.token;
    tenantAId = regA.body.data.tenant.id;
    adminAUserId = regA.body.data.user.id;

    // Viewer A in Tenant A
    const viewerAEmail = `rbac-viewera-${Date.now()}@example.com`;
    const viewerPassHash = await hashPassword('Password123!');
    const viewerAUser = await prisma.user.create({
      data: { tenantId: tenantAId, email: viewerAEmail, passwordHash: viewerPassHash },
    });
    viewerAUserId = viewerAUser.id;
    const viewerRole = await prisma.role.findFirst({ where: { tenantId: tenantAId, name: 'viewer' } });
    if (viewerRole) {
      await prisma.userRole.create({ data: { userId: viewerAUser.id, roleId: viewerRole.id } });
    }
    viewerTokenA = generateToken({
      userId: viewerAUser.id, tenantId: tenantAId, email: viewerAEmail, role: StandardRoles.VIEWER,
    });

    // Agent A in Tenant A
    const agentAEmail = `rbac-agenta-${Date.now()}@example.com`;
    const agentPassHash = await hashPassword('Password123!');
    const agentAUser = await prisma.user.create({
      data: { tenantId: tenantAId, email: agentAEmail, passwordHash: agentPassHash },
    });
    const agentRole = await prisma.role.findFirst({ where: { tenantId: tenantAId, name: 'agent' } });
    if (agentRole) {
      await prisma.userRole.create({ data: { userId: agentAUser.id, roleId: agentRole.id } });
    }
    agentTokenA = generateToken({
      userId: agentAUser.id, tenantId: tenantAId, email: agentAEmail, role: StandardRoles.AGENT,
    });

    // ─── Tenant B ────────────────────────────────────────────────────────
    const adminBEmail = `rbac-adminb-${Date.now()}@example.com`;
    const regB = await request(app)
      .post('/api/v1/auth/register')
      .send({
        tenantName: 'RBAC Tenant B',
        email: adminBEmail,
        password: 'Password123!',
      });
    adminTokenB = regB.body.data.token;
    tenantBId = regB.body.data.tenant.id;

    // ─── Fixtures: Tenant A conversation + lead ──────────────────────────
    const convA = await prisma.conversation.create({
      data: { tenantId: tenantAId, customerPhone: `+1555RBACA${Date.now()}`, customerName: 'Customer A' },
    });
    conversationAId = convA.id;

    const leadA = await prisma.lead.create({
      data: {
        tenantId: tenantAId, firstName: 'Lead', lastName: 'A',
        email: `lead-a-${Date.now()}@example.com`, status: 'new', score: 50,
      },
    });
    leadAId = leadA.id;
  });

  // =========================================================================
  // 1. Missing Authentication → 401 UNAUTHORIZED (fail-closed, AC-15)
  // =========================================================================
  describe('Missing Authentication Fail-Closed (AC-15)', () => {
    const noAuthRoutes = [
      { method: 'GET', path: '/api/v1/admin/audit-logs', label: 'admin audit-logs' },
      { method: 'GET', path: `/api/v1/tenants/${tenantAId || 'placeholder'}/tasks`, label: 'tasks list' },
      { method: 'GET', path: `/api/v1/tenants/${tenantAId || 'placeholder'}/conversations`, label: 'conversations list' },
      { method: 'GET', path: `/api/v1/tenants/${tenantAId || 'placeholder'}/leads`, label: 'leads list' },
      { method: 'GET', path: `/api/v1/tenants/${tenantAId || 'placeholder'}/finance/records`, label: 'finance records' },
      { method: 'GET', path: `/api/v1/auth/me`, label: 'auth /me' },
    ];

    noAuthRoutes.forEach(({ method, path, label }) => {
      it(`No-token → 401 UNAUTHORIZED on ${label}`, async () => {
        const res = method === 'GET'
          ? await request(app).get(path)
          : method === 'POST'
            ? await request(app).post(path)
            : method === 'PUT'
              ? await request(app).put(path)
              : await request(app).patch(path);
        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
        expect(res.body.error?.code).toBe('UNAUTHORIZED');
      });
    });

    it('Malformed Bearer token → 401 UNAUTHORIZED (fail-closed AC-15)', async () => {
      const res = await request(app)
        .get('/api/v1/admin/audit-logs')
        .set('Authorization', 'Bearer totally-invalid-token-xyz');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error?.code).toBe('UNAUTHORIZED');
    });
  });

  // =========================================================================
  // 2. Admin-only Endpoints Blocked for Agent + Viewer (AC-17)
  // =========================================================================
  describe('Admin-Only Endpoints (AC-17)', () => {
    it('Agent → GET /admin/audit-logs → 403 FORBIDDEN', async () => {
      const res = await request(app)
        .get('/api/v1/admin/audit-logs')
        .set('Authorization', `Bearer ${agentTokenA}`);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error?.code).toBe('FORBIDDEN');
    });

    it('Viewer → GET /admin/audit-logs → 403 FORBIDDEN', async () => {
      const res = await request(app)
        .get('/api/v1/admin/audit-logs')
        .set('Authorization', `Bearer ${viewerTokenA}`);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error?.code).toBe('FORBIDDEN');
    });

    it('Admin → GET /admin/audit-logs → 200 OK (baseline)', async () => {
      const res = await request(app)
        .get('/api/v1/admin/audit-logs')
        .set('Authorization', `Bearer ${adminTokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  // =========================================================================
  // 3. Role Allowed Access (admin full, viewer read ok, agent limited)
  // =========================================================================
  describe('Role Allowed Read Access', () => {
    it('Viewer → GET tasks (tasks:read) → 200 OK', async () => {
      const res = await request(app)
        .get(`/api/v1/tenants/${tenantAId}/tasks`)
        .set('Authorization', `Bearer ${viewerTokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('Viewer → GET conversations (support:read) → 200 OK', async () => {
      const res = await request(app)
        .get(`/api/v1/tenants/${tenantAId}/conversations`)
        .set('Authorization', `Bearer ${viewerTokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('Viewer → GET leads (sales:read) → 200 OK', async () => {
      const res = await request(app)
        .get(`/api/v1/tenants/${tenantAId}/leads`)
        .set('Authorization', `Bearer ${viewerTokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('Admin → GET conversations + tasks + leads → 200 OK (full access)', async () => {
      const [cRes, tRes, lRes] = await Promise.all([
        request(app).get(`/api/v1/tenants/${tenantAId}/conversations`).set('Authorization', `Bearer ${adminTokenA}`),
        request(app).get(`/api/v1/tenants/${tenantAId}/tasks`).set('Authorization', `Bearer ${adminTokenA}`),
        request(app).get(`/api/v1/tenants/${tenantAId}/leads`).set('Authorization', `Bearer ${adminTokenA}`),
      ]);
      expect(cRes.status).toBe(200); expect(cRes.body.success).toBe(true);
      expect(tRes.status).toBe(200); expect(tRes.body.success).toBe(true);
      expect(lRes.status).toBe(200); expect(lRes.body.success).toBe(true);
    });
  });

  // =========================================================================
  // 4. Viewer Write-Blocked on ALL Write Endpoints (AC-16)
  // =========================================================================
  describe('Viewer Write-Blocked (AC-16: every write endpoint 403)', () => {
    type ViewSpec = {
      method: 'POST' | 'PUT' | 'PATCH';
      build: (ids: { tenantId: string; convId: string; leadId: string }) => { path: string; body?: Record<string, unknown> };
      label: string;
    };
    const viewerWriteSpecs: ViewSpec[] = [
      { method: 'POST', build: ({ tenantId }) => ({ path: `/tenants/${tenantId}/tasks`, body: { title: 'viewer task' } }), label: 'POST tasks (tasks:execute)' },
      { method: 'PUT', build: ({ tenantId }) => ({ path: `/tenants/${tenantId}/support-config`, body: { name: 'X' } }), label: 'PUT support-config (support:write)' },
      { method: 'POST', build: ({ tenantId, convId }) => ({ path: `/tenants/${tenantId}/conversations/${convId}/reply`, body: { text: 'hi' } }), label: 'POST reply (support:write)' },
      { method: 'POST', build: ({ tenantId, convId }) => ({ path: `/tenants/${tenantId}/conversations/${convId}/pause-ai`, body: {} }), label: 'POST pause-ai (support:write)' },
      { method: 'POST', build: ({ tenantId, convId }) => ({ path: `/tenants/${tenantId}/conversations/${convId}/resume-ai`, body: {} }), label: 'POST resume-ai (support:write)' },
      { method: 'POST', build: ({ tenantId }) => ({ path: `/tenants/${tenantId}/leads`, body: { firstName: 'V', lastName: 'L', email: 'vl@x.com' } }), label: 'POST leads (sales:write)' },
      { method: 'PUT', build: ({ tenantId }) => ({ path: `/tenants/${tenantId}/sales/policy`, body: { maxDiscountPct: 5 } }), label: 'PUT sales/policy (sales:write)' },
      { method: 'PATCH', build: ({ tenantId, leadId }) => ({ path: `/tenants/${tenantId}/leads/${leadId}`, body: { firstName: 'Updated' } }), label: 'PATCH lead (sales:write)' },
      { method: 'PUT', build: ({ tenantId }) => ({ path: `/tenants/${tenantId}/finance/policy`, body: { defaultCurrency: 'USD' } }), label: 'PUT finance/policy (finance:write)' },
      { method: 'POST', build: ({ tenantId }) => ({ path: `/tenants/${tenantId}/finance/records`, body: { recordType: 'expense', amount: 10, description: 'x', occurredAt: new Date().toISOString() } }), label: 'POST finance records (finance:write)' },
      { method: 'PUT', build: ({ tenantId }) => ({ path: `/tenants/${tenantId}/operations/policy`, body: { lowStockAlertsEnabled: true } }), label: 'PUT operations/policy (operations:write)' },
      { method: 'POST', build: ({ tenantId }) => ({ path: `/tenants/${tenantId}/operations/products`, body: { sku: 'X1', name: 'Product' } }), label: 'POST products (operations:write)' },
      { method: 'PUT', build: ({ tenantId }) => ({ path: `/tenants/${tenantId}/marketing/profile`, body: { brandVoice: 'fun' } }), label: 'PUT marketing/profile (marketing:write)' },
      { method: 'POST', build: ({ tenantId }) => ({ path: `/tenants/${tenantId}/marketing/campaigns`, body: { name: 'C', objective: 'O' } }), label: 'POST campaigns (marketing:write)' },
      { method: 'PUT', build: ({ tenantId }) => ({ path: `/tenants/${tenantId}/harness/policy`, body: { maxInvocationsPerWindow: 50 } }), label: 'PUT harness/policy (tasks:execute)' },
      { method: 'PUT', build: ({ tenantId }) => ({ path: `/tenants/${tenantId}/autonomy/policy`, body: { notificationsEnabled: true } }), label: 'PUT autonomy/policy (tasks:execute)' },
    ];

    viewerWriteSpecs.forEach(({ method, build, label }) => {
      it(`Viewer → ${label} → 403 FORBIDDEN`, async () => {
        const { path, body } = build({ tenantId: tenantAId, convId: conversationAId, leadId: leadAId });
        const fullPath = `/api/v1${path}`;
        const res = method === 'POST'
          ? await request(app).post(fullPath).set('Authorization', `Bearer ${viewerTokenA}`).send(body || {})
          : method === 'PUT'
            ? await request(app).put(fullPath).set('Authorization', `Bearer ${viewerTokenA}`).send(body || {})
            : await request(app).patch(fullPath).set('Authorization', `Bearer ${viewerTokenA}`).send(body || {});
        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
        expect(res.body.error?.code).toBe('FORBIDDEN');
      });
    });
  });

  // =========================================================================
  // 5. Sensitive Operation: support-config PUT → requires support:write
  // =========================================================================
  describe('Sensitive Support Config Access', () => {
    it('Viewer → PUT support-config (contains tokens) → 403 FORBIDDEN', async () => {
      const res = await request(app)
        .put(`/api/v1/tenants/${tenantAId}/support-config`)
        .set('Authorization', `Bearer ${viewerTokenA}`)
        .send({ supportAccessToken: 'viewer-trying-to-inject-secret' });
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error?.code).toBe('FORBIDDEN');
    });

    it('Admin → PUT support-config → 200 OK', async () => {
      const res = await request(app)
        .put(`/api/v1/tenants/${tenantAId}/support-config`)
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ name: 'Test Biz Update', industry: 'Testing' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('Admin → GET support-config → 200 OK, tokens redacted', async () => {
      const res = await request(app)
        .get(`/api/v1/tenants/${tenantAId}/support-config`)
        .set('Authorization', `Bearer ${adminTokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data?.supportAccessToken).toBeUndefined();
      expect(res.body.data?.supportPhoneNumberId).toBeUndefined();
    });
  });

  // =========================================================================
  // 6. Sales Approval Review → needs approvals:manage + admin role (AC-11)
  // =========================================================================
  describe('Sales Approval Review Gate (AC-11)', () => {
    it('Agent → sales approval review → 403 (missing approvals:manage + admin role)', async () => {
      // Create a dummy approval first (tenant-scoped)
      const dummyAgent = await prisma.agent.create({
        data: { tenantId: tenantAId, department: 'sales', name: 'Sales Agent Temp' },
      });
      const approval = await prisma.approvalRequest.create({
        data: {
          tenantId: tenantAId, requestedByAgentId: dummyAgent.id,
          actionType: 'discount', actionPayload: { discountPct: 15 } as any,
        },
      });

      const res = await request(app)
        .post(`/api/v1/tenants/${tenantAId}/approval-requests/${approval.id}/review`)
        .set('Authorization', `Bearer ${agentTokenA}`)
        .send({ decision: 'approved' });
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error?.code).toBe('FORBIDDEN');
    });
  });

  // =========================================================================
  // 7. Cross-Tenant Access — Middleware Layer (path param tamper → 403)
  // =========================================================================
  describe('Cross-Tenant Blocked (Middleware + Service Layer, AC-12/24)', () => {
    it('Admin B path → Tenant A conversations → 403 TENANT_MISMATCH (middleware)', async () => {
      const res = await request(app)
        .get(`/api/v1/tenants/${tenantAId}/conversations`)
        .set('Authorization', `Bearer ${adminTokenB}`);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error?.code).toBe('TENANT_MISMATCH');
    });

    it('Admin B path → Tenant A tasks → 403 TENANT_MISMATCH (middleware)', async () => {
      const res = await request(app)
        .get(`/api/v1/tenants/${tenantAId}/tasks`)
        .set('Authorization', `Bearer ${adminTokenB}`);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error?.code).toBe('TENANT_MISMATCH');
    });

    it('Admin B body inject tenantId A → 403 TENANT_MISMATCH (body check)', async () => {
      const res = await request(app)
        .post(`/api/v1/tenants/${tenantBId}/tasks`)
        .set('Authorization', `Bearer ${adminTokenB}`)
        .send({ title: 'escalation attempt', tenantId: tenantAId });
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error?.code).toBe('TENANT_MISMATCH');
    });
  });

  // =========================================================================
  // 8. Cross-Tenant — Service Layer Defense (conversationService pause-ai)
  // =========================================================================
  describe('Service-Layer Tenant Ownership (conversationService pauseAI/resumeAI AC-12, AC-24)', () => {
    it('Admin B calls pause-ai on Tenant A conversationID via Tenant B path → conversation NOT mutated (service layer null)', async () => {
      const beforeConv = await prisma.conversation.findUnique({ where: { id: conversationAId } });
      expect(beforeConv).not.toBeNull();
      expect(beforeConv?.aiActive).toBe(true);

      const res = await request(app)
        .post(`/api/v1/tenants/${tenantBId}/conversations/${conversationAId}/pause-ai`)
        .set('Authorization', `Bearer ${adminTokenB}`);

      // Route: enforceTenantIsolation allows (path param tenantId matches B's token),
      // but controller calls conversationService.pauseAI(B, convAId) → findFirst with
      // { id: conversationAId, tenantId: B } → null → controller returns 404/null.
      expect([404, 500].includes(res.status) || !res.body.success).toBe(true);

      const afterConv = await prisma.conversation.findUnique({ where: { id: conversationAId } });
      expect(afterConv).not.toBeNull();
      expect(afterConv?.aiActive).toBe(true);
      expect(afterConv?.assignedAgentId).toBeNull();
    });

    it('Admin B calls resume-ai on Tenant A conversationID → conversation NOT mutated', async () => {
      // First pause it legitimately to test resume
      await prisma.conversation.update({ where: { id: conversationAId }, data: { aiActive: false } });
      const before = await prisma.conversation.findUnique({ where: { id: conversationAId } });
      expect(before?.aiActive).toBe(false);

      const res = await request(app)
        .post(`/api/v1/tenants/${tenantBId}/conversations/${conversationAId}/resume-ai`)
        .set('Authorization', `Bearer ${adminTokenB}`);

      expect(!res.body.success || [404, 500].includes(res.status)).toBe(true);

      const after = await prisma.conversation.findUnique({ where: { id: conversationAId } });
      expect(after?.aiActive).toBe(false);
    });

    it('Admin A correctly pauses/resumes OWN conversation → successful mutation (sanity check)', async () => {
      const pauseRes = await request(app)
        .post(`/api/v1/tenants/${tenantAId}/conversations/${conversationAId}/pause-ai`)
        .set('Authorization', `Bearer ${adminTokenA}`);
      expect(pauseRes.status).toBe(200);
      expect(pauseRes.body.success).toBe(true);

      const afterPause = await prisma.conversation.findUnique({ where: { id: conversationAId } });
      expect(afterPause?.aiActive).toBe(false);

      const resumeRes = await request(app)
        .post(`/api/v1/tenants/${tenantAId}/conversations/${conversationAId}/resume-ai`)
        .set('Authorization', `Bearer ${adminTokenA}`);
      expect(resumeRes.status).toBe(200);
      expect(resumeRes.body.success).toBe(true);

      const afterResume = await prisma.conversation.findUnique({ where: { id: conversationAId } });
      expect(afterResume?.aiActive).toBe(true);
    });
  });

  // =========================================================================
  // 9. Public Endpoints Remain Accessible (AC-13, AC-14)
  // =========================================================================
  describe('Public Endpoints Stay Public (AC-13, AC-14)', () => {
    it('POST /auth/register → no token → 201 (no 401)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ tenantName: 'Public Test', email: `pub-${Date.now()}@x.com`, password: 'Password123!' });
      expect(res.status).not.toBe(401);
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it('POST /auth/login → no token → 200/401 business logic, not auth middleware 401', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'does-not-exist@x.com', password: 'Password123!' });
      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe('UNAUTHORIZED');
      expect(res.body.error?.message).toMatch(/email|password|Invalid/i);
    });

    it('GET webhook challenge → no token → 200/403 business logic, not 401 middleware', async () => {
      const res = await request(app)
        .get(`/api/v1/webhook/${tenantAId}/whatsapp`)
        .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'WRONG_TOKEN', 'hub.challenge': 'CHALLENGE123' });
      expect(res.status).toBe(403);
      expect(res.body.error?.code).not.toBe('UNAUTHORIZED');
    });
  });

  // =========================================================================
  // 10. RequirePermission Missing Context Fails Closed (AC-15 direct)
  // =========================================================================
  describe('requirePermission / requireRole — Missing req.user → 401 fail-closed (AC-15)', () => {
    it('Empty Authorization header → GET tasks → 401 UNAUTHORIZED', async () => {
      const res = await request(app)
        .get(`/api/v1/tenants/${tenantAId}/tasks`)
        .set('Authorization', '');
      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe('UNAUTHORIZED');
    });

    it('No Authorization header at all → POST sales leads → 401 UNAUTHORIZED', async () => {
      const res = await request(app)
        .post(`/api/v1/tenants/${tenantAId}/leads`)
        .send({ firstName: 'No', lastName: 'Auth', email: 'na@x.com' });
      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe('UNAUTHORIZED');
    });
  });
});
