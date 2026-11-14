import fs from 'node:fs';
import path from 'node:path';

/**
 * Minimal .env loader — no dependency, no inline-comment support.
 * Existing process.env values always win (deployment env > file).
 */
export function loadEnvFile(startDir: string = process.cwd()): string | null {
  const file = findUp('.env', startDir);
  if (!file) return null;

  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (!key || process.env[key] !== undefined) continue;
    const value = rawValue?.replace(/^["']|["']$/g, '') ?? '';
    process.env[key] = value;
  }
  return file;
}

function findUp(name: string, dir: string): string | null {
  let current = path.resolve(dir);
  for (;;) {
    const candidate = path.join(current, name);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** Throws a clear error listing every missing variable. */
export function requireEnv<K extends string>(names: readonly K[]): Record<K, string> {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing environment variables: ${missing.join(', ')}\n` +
        'Copy .env.example to .env at the repo root and fill real values.',
    );
  }
  return Object.fromEntries(names.map((name) => [name, process.env[name] as string])) as Record<
    K,
    string
  >;
}

/** Returns env values that are present; marks the rest as skipped (never throws). */
export function probeEnv<K extends string>(
  names: readonly K[],
): { present: Record<string, string>; missing: K[] } {
  const missing: K[] = [];
  const present: Record<string, string> = {};
  for (const name of names) {
    const value = process.env[name];
    if (value) present[name] = value;
    else missing.push(name);
  }
  return { present, missing };
}
