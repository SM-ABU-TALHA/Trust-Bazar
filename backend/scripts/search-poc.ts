/**
 * search-poc.ts — Bengali/English search quality POC (PROMPT 10 gate).
 *
 * Runs 30 real-world queries through the same pipeline the API serves
 * (Atlas Search when enabled, otherwise the degraded regex fallback) and
 * prints the top results so precision can be eyeballed on real fixtures.
 *
 * Run: pnpm -C backend search:poc
 * Enable Atlas Search first (ATLAS_SEARCH_ENABLED=true) for the real evaluation.
 */
import mongoose from 'mongoose';
import { loadConfig } from '../src/config/index.js';
import { createDbContext } from '../src/db/context.js';
import { loadEnvFile } from '../src/lib/env.js';
import { memoryKv } from '../src/lib/kv.js';
import { createLogger } from '../src/lib/logger.js';
import { createStorage } from '../src/lib/storage.js';
import { SearchService } from '../src/services/search/search.service.js';

const QUERIES = [
  'আইফোন',
  'মোবাইল ফোন',
  'ল্যাপটপ',
  'সাইকেল',
  'মোটরসাইকেল',
  'ফ্রিজ',
  'ওয়াশিং মেশিন',
  'এয়ার কন্ডিশনার',
  'টেলিভিশন',
  'সোফা',
  'খাট',
  'ঘড়ি',
  'ক্যামেরা',
  'হেডফোন',
  'পাওয়ার ব্যাংক',
  'iphone 12',
  'samsung galaxy',
  'laptop hp',
  'dell inspiron',
  'bicycle',
  'motorcycle yamaha',
  'refrigerator',
  'washing machine',
  'air conditioner',
  'smart tv',
  'sofa set',
  'wooden bed',
  'smart watch',
  'dslr camera',
  'bluetooth earbuds',
] as const;

async function main() {
  loadEnvFile();
  const config = loadConfig(process.env);
  const logger = createLogger(config);
  const connection = mongoose.createConnection(config.MONGO_APP_URI, {
    autoIndex: false,
    serverSelectionTimeoutMS: 10_000,
  });
  await connection.asPromise();
  const repos = createDbContext(connection).repos;
  const service = new SearchService({
    config,
    repos,
    kv: memoryKv(),
    storage: createStorage(config),
    logger,
  });

  let empty = 0;
  let degradedCount = 0;
  let mode = '';

  for (const q of QUERIES) {
    const result = await service.search({
      q,
      sort: 'relevance',
      page: 1,
      limit: 5,
    } as never);
    mode = result.degraded ? 'degraded (regex fallback)' : 'atlas search';
    if (result.degraded) degradedCount += 1;
    if (result.total === 0) empty += 1;

    console.log(`\n"${q}" → ${result.total} result(s)`);
    for (const item of result.items.slice(0, 3)) {
      console.log(`   • ${item.title} — ৳${item.price} (${item.district ?? '—'})`);
    }
  }

  console.log(
    `\nPOC summary: ${QUERIES.length} queries · mode: ${mode} · ` +
      `empty: ${empty} · degraded runs: ${degradedCount}`,
  );
  console.log('Review precision above; if poor, add a transliteration field + text index (Architecture §10 #4).');

  await connection.close();
}

main().catch((error) => {
  console.error('search POC failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
