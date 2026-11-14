import type { ERROR_TYPES } from '@trust/shared/constants';
import type { ApiFieldError } from '@trust/shared/types';

type ErrorType = (typeof ERROR_TYPES)[number];

interface AppErrorOptions {
  readonly detail?: string;
  readonly retryable?: boolean;
  readonly errors?: readonly ApiFieldError[];
  readonly headers?: Record<string, string>;
  readonly cause?: unknown;
}

/** Domain error carrying the RFC-7807 contract (API_spec §0.5). */
export class AppError extends Error {
  readonly status: number;
  readonly type: ErrorType;
  readonly detail?: string;
  readonly retryable: boolean;
  readonly errors?: readonly ApiFieldError[];
  readonly headers?: Record<string, string>;

  constructor(status: number, type: ErrorType, title: string, options: AppErrorOptions = {}) {
    super(title, { cause: options.cause });
    this.status = status;
    this.type = type;
    this.detail = options.detail;
    this.retryable = options.retryable ?? false;
    this.errors = options.errors;
    this.headers = options.headers;
  }
}

export const err = {
  validation: (errors: readonly ApiFieldError[]) =>
    new AppError(400, 'validation_failed', 'Validation failed', { errors }),
  badRequest: (detail: string) => new AppError(400, 'bad_request', 'Bad request', { detail }),
  unauthenticated: (detail = 'Missing or invalid access token') =>
    new AppError(401, 'unauthenticated', 'Unauthenticated', { detail, retryable: true }),
  tokenRevoked: (detail = 'Session no longer valid') =>
    new AppError(401, 'token_revoked', 'Token revoked', { detail }),
  forbidden: (detail = 'Insufficient role') => new AppError(403, 'forbidden', 'Forbidden', { detail }),
  enforcementBlocked: (state: string, until?: Date) =>
    new AppError(403, 'enforcement_blocked', `Account ${state}`, {
      detail: until ? `until ${until.toISOString()}` : undefined,
    }),
  notFound: (detail = 'Resource not found') => new AppError(404, 'not_found', 'Not found', { detail }),
  conflict: (detail: string) => new AppError(409, 'state_conflict', 'Conflict', { detail }),
  businessRule: (detail: string) => new AppError(422, 'business_rule', 'Business rule violation', { detail }),
  idempotencyReplay: () =>
    new AppError(409, 'idempotency_replay', 'Idempotency-Key reused with a different payload', {
      retryable: true,
    }),
  rateLimited: (retryAfterSec: number) =>
    new AppError(429, 'rate_limited', 'Too many requests', {
      retryable: true,
      headers: { 'Retry-After': String(retryAfterSec) },
    }),
  upgradeRequired: (minVersion: string) =>
    new AppError(426, 'upgrade_required', 'Client upgrade required', {
      detail: `minimum version ${minVersion}`,
    }),
  degraded: (dependency: string) =>
    new AppError(503, 'degraded', `Dependency unavailable: ${dependency}`, { retryable: true }),
};

export interface ProblemBody {
  type: string;
  title: string;
  status: number;
  detail?: string;
  requestId: string;
  errors?: readonly ApiFieldError[];
  retryable: boolean;
}

const TYPE_BASE = 'https://api.trustbazar.com/errors';

/** Maps any thrown value to the RFC-7807 body (no internals leaked). */
export function toProblem(
  error: unknown,
  requestId: string,
  isProd: boolean,
): { status: number; body: ProblemBody; headers?: Record<string, string> } {
  if (error instanceof AppError) {
    return {
      status: error.status,
      headers: error.headers,
      body: {
        type: `${TYPE_BASE}/${error.type}`,
        title: error.message,
        status: error.status,
        ...(error.detail ? { detail: error.detail } : {}),
        requestId,
        ...(error.errors ? { errors: error.errors } : {}),
        retryable: error.retryable,
      },
    };
  }
  // Unknown errors: log happens in errorHandler; client sees a safe shape.
  return {
    status: 500,
    body: {
      type: `${TYPE_BASE}/internal_error`,
      title: 'Internal server error',
      status: 500,
      ...(isProd ? {} : { detail: error instanceof Error ? error.message : String(error) }),
      requestId,
      retryable: true,
    },
  };
}
