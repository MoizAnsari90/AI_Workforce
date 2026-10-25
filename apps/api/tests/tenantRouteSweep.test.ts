import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { autonomyRouter } from '../src/routes/autonomyRoutes';
import { billingRouter } from '../src/routes/billingRoutes';
import { businessSetupRouter } from '../src/routes/businessSetupRoutes';
import { financeRouter } from '../src/routes/financeRoutes';
import { harnessRouter } from '../src/routes/harnessRoutes';
import { marketingRouter } from '../src/routes/marketingRoutes';
import { nicheAutomationRouter } from '../src/routes/nicheAutomationRoutes';
import { nicheWorkflowRouter } from '../src/routes/nicheWorkflowRoutes';
import { operationsRouter } from '../src/routes/operationsRoutes';
import { orchestratorRouter } from '../src/routes/orchestratorRoutes';
import { salesRouter } from '../src/routes/salesRoutes';
import { shopifyRouter } from '../src/routes/shopifyRoutes';
import { storeReportRouter } from '../src/routes/storeReportRoutes';
import { tenantRouter } from '../src/routes/tenantRoutes';
import { voiceQuestionRouter } from '../src/routes/voiceQuestionRoutes';
import { webhookRouter } from '../src/routes/webhookRoutes';
import { woocommerceRouter } from '../src/routes/woocommerceRoutes';

type RouteDefinition = { path: string | string[]; methods: Record<string, boolean> };
type RouterLayer = { route?: RouteDefinition; handle?: { stack?: RouterLayer[] } };
type RouterStack = { stack?: RouterLayer[] };
type RouteCase = { method: string; path: string };

const tenantRouters: Array<{ router: unknown; prefix: string }> = [
  ...[
    autonomyRouter, billingRouter, businessSetupRouter, financeRouter, harnessRouter, marketingRouter,
    nicheAutomationRouter, nicheWorkflowRouter, operationsRouter, orchestratorRouter, salesRouter,
    storeReportRouter, tenantRouter, voiceQuestionRouter, webhookRouter, woocommerceRouter,
  ].map(router => ({ router, prefix: '/api/v1' })),
  { router: shopifyRouter, prefix: '/api/v1/tenants/:tenantId/shopify' },
];

function enumerateRoutes(router: unknown, prefix: string): RouteCase[] {
  const stack = (router as RouterStack).stack;
  if (!Array.isArray(stack)) return [];

  const routes: RouteCase[] = [];
  for (const layer of stack) {
    if (layer.route) {
      const routePaths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      for (const routePath of routePaths) {
        const path = `${prefix}${routePath.startsWith('/') ? '' : '/'}${routePath}`;
        if (!path.includes(':tenantId')) continue;
        if (path.includes('/webhook/:tenantId/')) continue;
        for (const [method, enabled] of Object.entries(layer.route.methods)) {
          if (enabled) routes.push({ method, path });
        }
      }
    }
  }
  return routes;
}

function materializePath(path: string, tenantId: string) {
  return path.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, (_match, name: string) =>
    name === 'tenantId' ? tenantId : '00000000-0000-4000-8000-000000000000',
  );
}

async function send(method: string, path: string, token: string) {
  const operation = request(app)[method as 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head'](path)
    .set('Authorization', `Bearer ${token}`);
  if (['post', 'put', 'patch'].includes(method)) operation.send({});
  return operation;
}

describe('Tenant route isolation sweep', () => {
  it('enumerates every tenant-scoped router', () => {
    expect(tenantRouters).toHaveLength(17);
  });

  let tenantA = '';
  let tokenA = '';
  let tenantB = '';

  beforeAll(async () => {
    const register = async (name: string) => request(app).post('/api/v1/auth/register').send({
      tenantName: name,
      email: `${name.replace(/\W+/g, '-').toLowerCase()}-${randomUUID()}@example.test`,
      password: 'Password123!',
    });
    const responseA = await register('Sweep Alpha');
    const responseB = await register('Sweep Beta');
    expect(responseA.status).toBe(201);
    expect(responseB.status).toBe(201);
    tenantA = responseA.body.data.tenant.id;
    tokenA = responseA.body.data.token;
    tenantB = responseB.body.data.tenant.id;
  });

  afterAll(async () => {
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
  });

  it('rejects tenant A credentials across every registered tenant route for tenant B', async () => {
    const routes = tenantRouters.flatMap(({ router, prefix }) => enumerateRoutes(router, prefix));
    expect(routes.length).toBeGreaterThan(0);

    for (const route of routes) {
      const response = await send(route.method, materializePath(route.path, tenantB), tokenA);
      expect([403, 404], `${route.method.toUpperCase()} ${route.path}`).toContain(response.status);
    }
  }, 60000);
});