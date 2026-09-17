import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { verifyToken } from '../services/authService';
import { logger } from '../utils/logger';

let io: SocketIOServer | null = null;

export function initSocketServer(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  // Socket Authentication Middleware
  io.use((socket: Socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace('Bearer ', '');
      if (!token) {
        return next(new Error('Authentication token required'));
      }

      const decoded = verifyToken(token);
      socket.data.user = decoded;
      socket.data.tenantId = decoded.tenantId;

      next();
    } catch (error) {
      logger.warn('Socket connection authentication rejected', {
        error: error instanceof Error ? error.message : String(error),
      });
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const tenantId = socket.data.tenantId;
    const userId = socket.data.user?.userId;

    if (tenantId) {
      const room = `tenant:${tenantId}`;
      socket.join(room);
      logger.info(`Socket connected and joined tenant room`, {
        socketId: socket.id,
        tenantId,
        userId,
        room,
      });
    }

    socket.on('disconnect', () => {
      logger.debug(`Socket disconnected: ${socket.id}`);
    });
  });

  return io;
}

export function getSocketServer(): SocketIOServer | null {
  return io;
}

export function emitToTenant(tenantId: string, event: string, payload: unknown) {
  if (!io) {
    logger.debug('Socket.io server not initialized, skipping event emission', { event, tenantId });
    return;
  }

  const room = `tenant:${tenantId}`;
  io.to(room).emit(event, {
    event,
    tenantId,
    timestamp: new Date().toISOString(),
    data: payload,
  });

  logger.debug(`Emitted socket event to ${room}`, { event, tenantId });
}
