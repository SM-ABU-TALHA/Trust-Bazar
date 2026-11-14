import type { RequestHandler } from 'express';
import { jwtVerify, errors as joseErrors } from 'jose';
import { err } from '../lib/errors.js';
import type { AuthUser } from '../types/express.js';

export interface JwtPayloadShape {
  roles?: AuthUser['roles'];
  enforcement?: { state?: AuthUser['enforcement']['state']; until?: string };
  sid?: string;
  deviceFp?: string;
  platform?: AuthUser['platform'];
}

export interface AuthOptions {
  /**
   * Optional session-registry check (PROMPT 05). A token whose session was
   * logged out or wiped by refresh-reuse detection is rejected immediately
   * instead of living until its 15-minute expiry.
   */
  isSessionActive?: (userId: string, sessionId: string) => Promise<boolean>;
}

/** Step 3 — Bearer JWT verification (jose, HS256) + optional session check. */
export function auth(accessSecret: string, options: AuthOptions = {}): RequestHandler {
  const key = new TextEncoder().encode(accessSecret);

  return async (req, _res, next) => {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) {
      return next(err.unauthenticated('Missing Bearer token'));
    }
    try {
      const { payload } = await jwtVerify(header.slice(7), key);
      const claims = payload as JwtPayloadShape & { sub?: string };
      if (!claims.sub) return next(err.unauthenticated('Token has no subject'));

      const sessionId = claims.sid ?? '';
      if (options.isSessionActive && !(await options.isSessionActive(claims.sub, sessionId))) {
        return next(err.tokenRevoked('Session no longer active'));
      }

      req.user = {
        id: claims.sub,
        roles: claims.roles ?? ['buyer'],
        enforcement: {
          state: claims.enforcement?.state ?? 'none',
          ...(claims.enforcement?.until ? { until: new Date(claims.enforcement.until) } : {}),
        },
        sessionId,
        deviceFp: claims.deviceFp ?? '',
        platform: claims.platform ?? 'web',
      };
      next();
    } catch (error) {
      if (error instanceof joseErrors.JWTExpired) {
        return next(err.unauthenticated('Token expired'));
      }
      next(err.unauthenticated('Invalid token'));
    }
  };
}
