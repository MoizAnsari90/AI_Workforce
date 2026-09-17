import http from 'http';
import { app } from './app';
import { env } from './config/env';
import { logger } from './utils/logger';
import { queueService } from './services/queueService';
import { supportAgentService } from './services/supportAgentService';
import { initSocketServer } from './lib/socket';
import { autonomyService } from './services/autonomyService';
import { prisma } from './lib/prisma';

// Create HTTP server so Socket.io can share it with Express
const httpServer = http.createServer(app);

// Initialize Socket.io
initSocketServer(httpServer);

// Register the support agent as the BullMQ message processor
queueService.registerProcessor(async (data) => {
  await supportAgentService.processInboundMessage(data.tenantId, data.message);
});

autonomyService.startScheduler();

httpServer.listen(env.PORT, () => {
  logger.info(`AI Workforce API server running on port ${env.PORT} in ${env.NODE_ENV} mode`, {
    port: env.PORT,
    environment: env.NODE_ENV,
  });
});

async function shutdown() {
  logger.info('Shutting down gracefully');
  try {
    await queueService.close();
    autonomyService.stopScheduler();
    await prisma.$disconnect();
    httpServer.close(() => {
      logger.info('Process terminated');
      process.exit(0);
    });
  } catch (e) {
    logger.error('Error during shutdown', { error: e });
    process.exit(1);
  }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
