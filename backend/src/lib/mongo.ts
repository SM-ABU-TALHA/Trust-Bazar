import mongoose, { type Connection } from 'mongoose';

/** Native handle type derived from Mongoose — avoids a second `mongodb` copy. */
export type NativeDb = NonNullable<Connection['db']>;

export interface MongoHandle {
  /** App-cluster Mongoose connection (models are bound to this). */
  app: Connection;
  /** Audit-cluster connection; `null` while the cluster is not provisioned. */
  audit: Connection | null;
  /** Native handle for infrastructure code (health, idempotency, config route). */
  appDb: NativeDb;
  close: () => Promise<void>;
}

/**
 * Connects both clusters with Mongoose.
 * Audit is fail-SOFT in dev (its cluster may not be provisioned yet) — audit
 * writes surface per-request errors instead of blocking boot. App cluster
 * failure aborts boot. `autoIndex` is always off: indexes come from migrate.ts.
 */
export async function connectMongo(
  appUri: string,
  auditUri: string,
  onAuditFailure: (message: string) => void,
): Promise<MongoHandle> {
  mongoose.set('strictQuery', true);

  const app = mongoose.createConnection(appUri, {
    autoIndex: false,
    serverSelectionTimeoutMS: 10_000,
  });
  await app.asPromise();
  const nativeDb = app.db;
  if (!nativeDb) throw new Error('Mongoose app connection has no native Db handle');

  let audit: Connection | null = null;
  try {
    const candidate = mongoose.createConnection(auditUri, {
      autoIndex: false,
      serverSelectionTimeoutMS: 5_000,
    });
    await candidate.asPromise();
    audit = candidate;
  } catch (error) {
    audit = null;
    onAuditFailure(error instanceof Error ? error.message : String(error));
  }

  return {
    app,
    audit,
    appDb: nativeDb,
    close: async () => {
      await Promise.allSettled([app.close(), audit?.close()]);
    },
  };
}
