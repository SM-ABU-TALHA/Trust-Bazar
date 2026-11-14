import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { mediaSignSchema, type MediaSignInput } from '@trust/shared/schemas';
import type { Config } from '../config/index.js';
import { ah } from '../lib/async-handler.js';
import { err } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import {
  LocalStorageDriver,
  verifyLocalSignature,
  type StorageDriver,
} from '../lib/storage.js';
import {
  enforcementGate,
  rateLimit,
  validate,
  type RateLimitStore,
} from '../middleware/index.js';
import { buildRequireAuth } from '../middleware/require-auth.js';
import type { Repositories } from '../repositories/index.js';
import { MediaService } from '../services/media/media.service.js';

export interface MediaRouteDeps {
  config: Config;
  logger: Logger;
  repos: Repositories;
  storage: StorageDriver;
  rateStore: RateLimitStore;
}

const idParams = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i, 'invalid_id') });

export function mediaRoutes(deps: MediaRouteDeps): Router {
  const { config, storage } = deps;
  const router = Router();
  const requireAuth = buildRequireAuth(config, deps.repos);
  const service = new MediaService({
    config,
    repos: deps.repos,
    storage,
    logger: deps.logger,
  });

  router.post(
    '/media/sign',
    requireAuth,
    enforcementGate,
    rateLimit('media_sign', deps.rateStore, { max: 30, window: '1m' }),
    validate({ body: mediaSignSchema }),
    ah(async (req, res) => {
      const result = await service.sign(userId(req), req.body as MediaSignInput);
      sendData(req, res, 201, result);
    }),
  );

  router.post(
    '/media/:id/complete',
    requireAuth,
    enforcementGate,
    validate({ params: idParams }),
    ah(async (req, res) => {
      sendData(req, res, 200, await service.complete(userId(req), req.params.id as string));
    }),
  );

  // ── Local dev driver only: presigned PUT/GET against this process ────────
  if (storage instanceof LocalStorageDriver) {
    const raw = express.raw({ type: () => true, limit: '12mb' });

    router.put(
      '/media/blob',
      raw,
      ah(async (req, res) => {
        const { key, expires, sig } = blobQuery(req);
        if (!verifyLocalSignature(config.JWT_ACCESS_SECRET, 'PUT', key, expires, sig)) {
          throw err.forbidden('invalid_upload_signature');
        }
        if (!key.startsWith('incoming/')) throw err.forbidden('invalid_upload_key');
        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
          throw err.validation([{ field: 'body', code: 'custom', message: 'empty_body' }]);
        }
        const purpose = key.split('/')[1];
        if (purpose !== 'kyc' && purpose !== 'listing' && purpose !== 'profile') {
          throw err.forbidden('invalid_upload_key');
        }
        await storage.write({ key, purpose, body: req.body });
        res.status(204).end();
      }),
    );

    router.get(
      '/media/blob',
      ah(async (req, res) => {
        const { key, expires, sig } = blobQuery(req);
        if (!verifyLocalSignature(config.JWT_ACCESS_SECRET, 'GET', key, expires, sig)) {
          throw err.forbidden('invalid_media_signature');
        }
        const purpose = key.split('/')[1];
        if (purpose !== 'kyc' && purpose !== 'listing' && purpose !== 'profile') {
          throw err.forbidden('invalid_media_key');
        }
        const body = await storage.read({ key, purpose }).catch(() => {
          throw err.notFound('media_not_found');
        });
        res.setHeader('Content-Type', contentTypeFor(key));
        res.setHeader('Cache-Control', 'private, max-age=300');
        res.end(body);
      }),
    );
  }

  // ── Internal worker callback (API_spec §12.3) ────────────────────────────
  router.post(
    '/internal/media/:id/process',
    internalOnly(config),
    validate({ params: idParams }),
    ah(async (req, res) => {
      sendData(req, res, 200, await service.process(req.params.id as string));
    }),
  );

  return router;
}

function internalOnly(config: Config) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const secret = config.INTERNAL_SECRET;
    if (!secret) {
      next(err.notFound('internal_endpoint_disabled'));
      return;
    }
    if (req.headers['x-internal-secret'] !== secret) {
      next(err.forbidden('invalid_internal_secret'));
      return;
    }
    next();
  };
}

function blobQuery(req: Request): { key: string; expires: number; sig: string } {
  const key = String(req.query.key ?? '');
  const expires = Number(req.query.expires ?? 0);
  const sig = String(req.query.sig ?? '');
  if (!key || !sig) throw err.forbidden('missing_media_signature');
  return { key, expires, sig };
}

function contentTypeFor(key: string): string {
  if (key.endsWith('.png')) return 'image/png';
  if (key.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function sendData(req: Request, res: Response, status: number, data: unknown): void {
  res.status(status).json({ data, meta: { requestId: req.id } });
}

function userId(req: Request): string {
  if (!req.user) throw err.unauthenticated('Missing access token');
  return req.user.id;
}
