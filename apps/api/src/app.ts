import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import { logger } from './utils/logger';
import { errorHandler } from './middleware/errorHandler';
import { shopifyRouter } from './routes/shopifyRoutes';
import { shopifyOAuthRouter } from './routes/shopifyOAuthRoutes';
import { whatsappOnboardingRouter } from './routes/whatsappOnboardingRoutes';
import { woocommerceRouter } from './routes/woocommerceRoutes';
import { authRouter } from './routes/authRoutes';
import { tenantRouter } from './routes/tenantRoutes';
import { webhookRouter } from './routes/webhookRoutes';
import { salesRouter } from './routes/salesRoutes';
import { marketingRouter } from './routes/marketingRoutes';
import { operationsRouter } from './routes/operationsRoutes';
import { financeRouter } from './routes/financeRoutes';
import { orchestratorRouter } from './routes/orchestratorRoutes';
import { harnessRouter } from './routes/harnessRoutes';
import { autonomyRouter } from './routes/autonomyRoutes';
import { NotFoundError } from './errors/AppError';
import { prisma } from './lib/prisma';
import { queueService } from './services/queueService';

// Rate Limiters
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
  skip: (req) => req.originalUrl.startsWith('/api/v1/webhook'),
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later.' },
  skip: (req) => req.originalUrl.startsWith('/api/v1/webhook'),
});

export function createApp() {
  const app = express();

  // Basic middleware
  app.use(cors());
  app.use('/api/v1/webhook', express.raw({ type: ['application/json', 'application/*+json'], limit: '1mb' }));
  app.use(express.json());

  // Request logger
  app.use((req, _res, next) => {
    logger.debug(`Incoming request: ${req.method} ${req.url}`, {
      method: req.method,
      url: req.url,
      ip: req.ip,
    });
    next();
  });

  // Health check endpoint
  app.get('/health', async (_req, res) => {
    const checks = {
      database: false,
      redis: false,
    };

    // Check DB
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = true;
    } catch (e) {
      logger.error('Database health check failed', { error: e });
    }

    // Check Redis
    try {
      checks.redis = queueService.getRedisStatus() === 'ready';
    } catch (e) {
      logger.error('Redis health check failed', { error: e });
    }

    const healthy = checks.database && checks.redis;

    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      checks,
    });
  });

  // API Routes (registering webhooks first)
  app.use('/api/v1', webhookRouter);

  // Apply rate limiters
  // Webhooks route is skipped by placing authLimiter and globalLimiter after the webhook setup
  app.use('/api/v1/auth', authLimiter);
  app.use('/api/v1', globalLimiter);

  // Other Routes
  app.use('/api/v1/shopify/oauth', shopifyOAuthRouter);
  app.use('/api/v1/whatsapp/onboarding', whatsappOnboardingRouter);
  app.use('/api/v1/woocommerce', woocommerceRouter);
  app.use('/api/v1/tenants/:tenantId/shopify', shopifyRouter);
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1', tenantRouter);
  app.use('/api/v1', salesRouter);
  app.use('/api/v1', marketingRouter);
  app.use('/api/v1', operationsRouter);
  app.use('/api/v1', financeRouter);
  app.use('/api/v1', orchestratorRouter);
  app.use('/api/v1', harnessRouter);
  app.use('/api/v1', autonomyRouter);

  // Catch-all 404 handler
  app.use((req, _res, next) => {
    next(new NotFoundError(`Route ${req.method} ${req.originalUrl} not found`));
  });

  // Global Error Handler
  app.use(errorHandler);

  return app;
}

export const app = createApp();
