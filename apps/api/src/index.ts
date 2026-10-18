import http from 'http';
import { app } from './app';
import { env } from './config/env';
import { logger } from './utils/logger';
import { queueService } from './services/queueService';
import { supportAgentService } from './services/supportAgentService';
import { initSocketServer, getSocketServer } from './lib/socket';
import { autonomyService } from './services/autonomyService';
import { prisma } from './lib/prisma';
import { startNicheAutomation, stopNicheAutomation } from './services/nicheAutomationWorker';
import { startStoreReports, stopStoreReports } from './services/storeReportScheduler';

// Create HTTP server so Socket.io can share it with Express
const httpServer = http.createServer(app);

// Initialize Socket.io
initSocketServer(httpServer);

// Register the support agent as the BullMQ message processor
if (env.BACKGROUND_WORKERS_ENABLED === 'true') {
  queueService.registerProcessor(async (data) => {
    await supportAgentService.processInboundMessage(data.tenantId, data.message);
  });
  autonomyService.startScheduler();
  startNicheAutomation();
  startStoreReports();
}

httpServer.listen(env.PORT, '0.0.0.0', () => {
  logger.info(`AI Workforce API server running on port ${env.PORT} in ${env.NODE_ENV} mode`, {
    port: env.PORT,
    environment: env.NODE_ENV,
  });
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('Shutting down gracefully');
  const deadline = setTimeout(() => {
    logger.error('Shutdown deadline reached; persisted jobs will recover on restart');
    process.exit(1);
  }, 9000);
  deadline.unref();
  const serverClosed = new Promise<void>(resolve => httpServer.close(() => resolve()));
  getSocketServer()?.close();
  autonomyService.stopScheduler();
  try {
    await Promise.all([queueService.close(), stopNicheAutomation(), stopStoreReports()]);
    await prisma.$disconnect();
    await serverClosed;
    clearTimeout(deadline);
    logger.info('Process terminated');
    process.exit(0);
  } catch (e) {
    logger.error('Error during shutdown', { error: e });
    process.exit(1);
  }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
