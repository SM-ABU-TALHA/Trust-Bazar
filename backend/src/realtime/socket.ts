import type { Server as HttpServer } from 'node:http';
import { jwtVerify } from 'jose';
import { Server, type Socket } from 'socket.io';
import { ZodError } from 'zod';
import { LIMITS } from '@trust/shared/constants';
import { sendMessageSchema } from '@trust/shared/schemas';
import type { Config } from '../config/index.js';
import { AppError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import type { Repositories } from '../repositories/index.js';
import type { ChatService } from '../services/chat/chat.service.js';

export interface RealtimeDeps {
  config: Config;
  logger: Logger;
  repos: Repositories;
  chat: ChatService;
}

interface SessionShape {
  id?: string;
}

/**
 * In-process Socket.IO (PROMPT 11). The HTTP API remains the source of truth;
 * sockets reuse `ChatService.sendMessage`, so idempotency and thread-state
 * gates apply identically. A per-connection 30 msg/min cap protects fan-out.
 */
export function attachRealtime(server: HttpServer, deps: RealtimeDeps) {
  const isProd = deps.config.NODE_ENV === 'production';
  const key = new TextEncoder().encode(deps.config.JWT_ACCESS_SECRET);

  const io = new Server(server, {
    path: '/socket.io',
    cors: {
      origin: ['https://app.trustbazar.com', ...(isProd ? [] : ['http://localhost:3000'])],
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    try {
      const header = socket.handshake.headers.authorization;
      const token =
        (socket.handshake.auth?.token as string | undefined) ??
        (header?.startsWith('Bearer ') ? header.slice(7) : undefined);
      if (!token) return next(new Error('unauthenticated'));

      const { payload } = await jwtVerify(token, key);
      const claims = payload as { sub?: string; sid?: string };
      if (!claims.sub) return next(new Error('unauthenticated'));

      const user = await deps.repos.users.findById(claims.sub);
      const sessions = (user?.sessions as SessionShape[] | undefined) ?? [];
      if (!sessions.some((session) => session.id === claims.sid)) {
        return next(new Error('unauthenticated'));
      }

      socket.data.userId = claims.sub;
      next();
    } catch {
      next(new Error('unauthenticated'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId as string;
    void socket.join(`user:${userId}`);

    let windowStart = Date.now();
    let sentInWindow = 0;
    const allowSend = (): boolean => {
      const now = Date.now();
      if (now - windowStart >= 60_000) {
        windowStart = now;
        sentInWindow = 0;
      }
      sentInWindow += 1;
      return sentInWindow <= LIMITS.chat.sendPerMinute;
    };

    socket.on('thread:join', async (payload: { threadId?: string }, ack?: Ack) => {
      try {
        const thread = await deps.chat.getParticipantThread(userId, requireThreadId(payload));
        await socket.join(`thread:${thread._id.toString()}`);
        ack?.({ ok: true });
      } catch (error) {
        emitError(socket, error, deps.logger);
        ack?.({ ok: false });
      }
    });

    socket.on('thread:leave', async (payload: { threadId?: string }, ack?: Ack) => {
      try {
        await socket.leave(`thread:${requireThreadId(payload)}`);
        ack?.({ ok: true });
      } catch (error) {
        emitError(socket, error, deps.logger);
        ack?.({ ok: false });
      }
    });

    socket.on(
      'message:send',
      async (
        payload: { threadId?: string; clientMsgId?: string; body?: string },
        ack?: Ack,
      ) => {
        if (!allowSend()) {
          socket.emit('chat:error', {
            type: 'rate_limited',
            status: 429,
            detail: 'per-connection limit 30 msg/min',
          });
          ack?.({ ok: false, error: 'rate_limited' });
          return;
        }

        try {
          const threadId = requireThreadId(payload);
          const input = sendMessageSchema.parse(payload);
          const message = await deps.chat.sendMessage(userId, threadId, input);
          const event = { ...message, threadId };
          io.to(`thread:${threadId}`).emit('message:new', event);
          ack?.({ ok: true, message: event });
        } catch (error) {
          emitError(socket, error, deps.logger);
          ack?.({ ok: false });
        }
      },
    );
  });

  return {
    io,
    close: (): void => {
      io.close();
    },
  };
}

type Ack = (response: { ok: boolean; message?: unknown; error?: string }) => void;

function requireThreadId(payload: { threadId?: string } | undefined): string {
  if (!payload?.threadId || !/^[a-f\d]{24}$/i.test(payload.threadId)) {
    throw new AppError(400, 'validation_failed', 'Validation failed', {
      errors: [{ field: 'threadId', code: 'custom', message: 'invalid_id' }],
    });
  }
  return payload.threadId;
}

function emitError(socket: Socket, error: unknown, logger: Logger): void {
  if (error instanceof AppError) {
    socket.emit('chat:error', {
      type: error.type,
      status: error.status,
      ...(error.detail ? { detail: error.detail } : {}),
      ...(error.errors ? { errors: error.errors } : {}),
    });
    return;
  }
  if (error instanceof ZodError) {
    socket.emit('chat:error', {
      type: 'validation_failed',
      status: 400,
      errors: error.issues.map((issue) => ({
        field: issue.path.join('.') || '(root)',
        code: issue.code,
        message: issue.message,
      })),
    });
    return;
  }
  logger.error({ err: error }, 'realtime handler failed');
  socket.emit('chat:error', { type: 'internal_error', status: 500 });
}
