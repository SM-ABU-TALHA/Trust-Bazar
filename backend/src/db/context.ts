import mongoose, { type Connection } from 'mongoose';
import { createAuditModels, createModels, type Models } from '../models/index.js';
import { createRepositories, type Repositories } from '../repositories/index.js';

export interface DbContext {
  app: Connection;
  audit: Connection | null;
  models: Models;
  repos: Repositories;
}

let context: DbContext | null = null;

/** Called once at boot (server.ts) with the live connection. */
export function initDbContext(app: Connection, audit: Connection | null): DbContext {
  if (context) return context;
  const models = createModels(app);
  const auditModels = audit ? createAuditModels(audit) : null;
  context = { app, audit, models, repos: createRepositories(models, auditModels) };
  return context;
}

/** Test-only: bind a throwaway connection (fresh models, no globals leaking). */
export function createDbContext(app: Connection, audit: Connection | null = null): DbContext {
  const models = createModels(app);
  return {
    app,
    audit,
    models,
    repos: createRepositories(models, audit ? createAuditModels(audit) : null),
  };
}

export function getDbContext(): DbContext {
  if (!context) throw new Error('DB context not initialised — call initDbContext() at boot');
  return context;
}

/** Clean shutdown for tests and tooling. */
export async function resetDbContext(): Promise<void> {
  if (context) {
    await context.app.close();
    await context.audit?.close();
  }
  context = null;
  await mongoose.disconnect();
}
