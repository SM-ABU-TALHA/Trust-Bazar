import type { Db } from 'mongodb';
import { AUDIT_INDEXES, APP_INDEXES, type IndexDef } from './indexes.js';
import { VALIDATORS, type ValidatorSpec } from './validators.js';

/** stdout sink — migrate is a CLI, so plain lines are intentional. */
const log = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

export interface IndexResult {
  created: number;
  existed: number;
  pruned: string[];
}

/**
 * Creates every index in the spec and prunes indexes that are no longer
 * declared (except `_id_`) so the DB never drifts from database.md §4.
 * Idempotent: an unchanged re-run creates 0 indexes.
 */
export async function applyIndexes(
  db: Db,
  spec: Record<string, readonly IndexDef[]>,
): Promise<IndexResult> {
  let created = 0;
  let existed = 0;
  const pruned: string[] = [];

  for (const [collection, indexes] of Object.entries(spec)) {
    const coll = db.collection(collection);
    let existing = new Map<string, string[]>();
    try {
      for (const index of await coll.listIndexes().toArray()) {
        if (!index.name) continue;
        existing.set(index.name, index.key ? Object.keys(index.key) : []);
      }
    } catch (error) {
      // Collection doesn't exist yet (Atlas NamespaceNotFound, code 26) —
      // createIndex auto-creates it; start from an empty set.
      if ((error as { code?: number }).code !== 26) throw error;
      existing = new Map();
    }

    for (const { name, keys, ...options } of indexes) {
      try {
        await coll.createIndex(keys, { name, ...options });
      } catch (error) {
        // Same name, different options (e.g. adding a partial filter) —
        // Mongo rejects with IndexOptionsConflict/IndexKeySpecsConflict.
        const code = (error as { code?: number }).code;
        if (code !== 85 && code !== 86) throw error;
        await coll.dropIndex(name);
        await coll.createIndex(keys, { name, ...options });
        log(`  replaced ${collection}.${name}`);
      }
      if (existing.has(name)) existed += 1;
      else created += 1;
      log(`  ${existing.has(name) ? 'exists ' : 'created'}  ${collection}.${name}`);
    }

    // Prune undeclared indexes (keeps `_id_`).
    const declared = new Set(indexes.map((index) => index.name));
    for (const name of existing.keys()) {
      if (name === '_id_' || declared.has(name)) continue;
      await coll.dropIndex(name);
      pruned.push(`${collection}.${name}`);
      log(`  dropped  ${collection}.${name}`);
    }
  }

  return { created, existed, pruned };
}

/**
 * Applies `$jsonSchema` validators with `validationLevel: "strict"` and
 * `validationAction: "error"`. Creates the collection when it is missing.
 */
export async function applyValidators(
  db: Db,
  specs: readonly ValidatorSpec[] = VALIDATORS,
): Promise<string[]> {
  const applied: string[] = [];
  for (const { collection, jsonSchema } of specs) {
    const command = {
      collMod: collection,
      validator: { $jsonSchema: jsonSchema },
      validationLevel: 'strict',
      validationAction: 'error',
    };
    try {
      await db.command(command);
    } catch (error) {
      if ((error as { code?: number }).code !== 26) throw error;
      await db.createCollection(collection, {
        validator: { $jsonSchema: jsonSchema },
        validationLevel: 'strict',
        validationAction: 'error',
      });
    }
    applied.push(collection);
    log(`  validator  ${collection}`);
  }
  return applied;
}

export { APP_INDEXES, AUDIT_INDEXES, VALIDATORS };
