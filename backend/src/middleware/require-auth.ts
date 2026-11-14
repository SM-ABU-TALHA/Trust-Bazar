import type { RequestHandler } from 'express';
import type { Config } from '../config/index.js';
import { auth } from './auth.js';
import type { Repositories } from '../repositories/index.js';

/**
 * Shared bearer-auth middleware. A JWT is only honoured while its `sid`
 * is still present in the user's session registry (PROMPT 05 contract).
 */
export function buildRequireAuth(config: Config, repos: Repositories): RequestHandler {
  return auth(config.JWT_ACCESS_SECRET, {
    isSessionActive: async (userId, sessionId) => {
      const user = await repos.users.findById(userId);
      const sessions = (user?.sessions as Array<{ id?: string }> | undefined) ?? [];
      return sessions.some((session) => session.id === sessionId);
    },
  });
}
