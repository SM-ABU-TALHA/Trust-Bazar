import type { EnforcementState, Platform, Role } from '@trust/shared/constants';

export interface AuthUser {
  id: string;
  roles: Role[];
  enforcement: { state: EnforcementState; until?: Date };
  sessionId: string;
  deviceFp: string;
  platform: Platform;
}

declare global {
  namespace Express {
    interface Request {
      /** Correlation ID — echoed as X-Request-Id. */
      id: string;
      user?: AuthUser;
      /** Operator session (PROMPT 16) — never set for user tokens. */
      operator?: { id: string; role: string };
    }
  }
}

export {};
