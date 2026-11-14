import { randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { Config } from '../../config/index.js';
import { sha256 } from '../../lib/crypto.js';
import { err } from '../../lib/errors.js';

export const ACCESS_TTL_SEC = 15 * 60;
export const REFRESH_TTL_SEC = 30 * 24 * 60 * 60;
export const REFRESH_COOKIE = 'tb_refresh';

const ISSUER = 'trustbazar';
const ACCESS_AUDIENCE = 'trustbazar-api';
const REFRESH_AUDIENCE = 'trustbazar-refresh';
const OPS_AUDIENCE = 'trustbazar-ops';

export interface OperatorClaims {
  sub: string;
  role: string;
  typ: 'ops';
}

export type Platform = 'web' | 'android' | 'ios';

/** Session subdocument inside `users.sessions` (max 3, database.md §2.1). */
export interface SessionRecord {
  id: string;
  deviceIdHash: string;
  platform: Platform;
  refreshTokenHash: string;
  issuedAt: Date;
  expiresAt: Date;
  lastUsedAt: Date;
}

export interface SessionUser {
  id: string;
  roles: string[];
  enforcement: { state: string; until?: Date };
}

export interface RefreshClaims {
  sub: string;
  sid: string;
}

function accessKey(config: Config): Uint8Array {
  return new TextEncoder().encode(config.JWT_ACCESS_SECRET);
}

function refreshKey(config: Config): Uint8Array {
  return new TextEncoder().encode(config.JWT_REFRESH_SECRET);
}

/** Access JWT: 15 min, carries identity + session so middleware needs no query. */
export function signAccessToken(
  config: Config,
  user: SessionUser,
  session: Pick<SessionRecord, 'id' | 'deviceIdHash' | 'platform'>,
): Promise<string> {
  return new SignJWT({
    roles: user.roles,
    enforcement: {
      state: user.enforcement.state,
      ...(user.enforcement.until ? { until: user.enforcement.until.toISOString() } : {}),
    },
    sid: session.id,
    deviceFp: session.deviceIdHash,
    platform: session.platform,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setAudience(ACCESS_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SEC}s`)
    .sign(accessKey(config));
}

/** Refresh JWT: 30-day rolling, bound to one session id. */
export function signRefreshToken(
  config: Config,
  userId: string,
  sessionId: string,
  expiresAt: Date,
): Promise<string> {
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(REFRESH_AUDIENCE)
    .setIssuedAt()
    .setJti(randomUUID()) // rotation must yield a distinct token even within 1s
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(refreshKey(config));
}

/** Invalid/expired refresh tokens are `401 token_revoked` (API §0.5). */
export async function verifyRefreshToken(config: Config, token: string): Promise<RefreshClaims> {
  try {
    const { payload } = await jwtVerify(token, refreshKey(config), {
      issuer: ISSUER,
      audience: REFRESH_AUDIENCE,
    });
    const sid = typeof payload.sid === 'string' ? payload.sid : '';
    if (!payload.sub || !sid) throw new Error('missing claims');
    return { sub: payload.sub, sid };
  } catch {
    throw err.tokenRevoked('Refresh token invalid or expired');
  }
}

/** Operator JWT: 15 min, `typ:'ops'`, separate audience from user tokens. */
export function signOperatorToken(
  config: Config,
  operator: { id: string; role: string },
): Promise<string> {
  return new SignJWT({ role: operator.role, typ: 'ops' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(operator.id)
    .setIssuer(ISSUER)
    .setAudience(OPS_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SEC}s`)
    .sign(accessKey(config));
}

export async function verifyOperatorToken(
  config: Config,
  token: string,
): Promise<OperatorClaims> {
  try {
    const { payload } = await jwtVerify(token, accessKey(config), {
      issuer: ISSUER,
      audience: OPS_AUDIENCE,
    });
    if (payload.typ !== 'ops' || typeof payload.role !== 'string' || !payload.sub) {
      throw new Error('missing claims');
    }
    return { sub: payload.sub, role: payload.role, typ: 'ops' };
  } catch {
    throw err.unauthenticated('Operator token invalid or expired');
  }
}

/** Refresh tokens are stored hashed — a DB leak never yields a usable token. */
export function hashRefreshToken(token: string): string {
  return sha256(token);
}
