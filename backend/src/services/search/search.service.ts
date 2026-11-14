import { Types } from 'mongoose';
import type { SearchQuery } from '@trust/shared/schemas';
import type { Config } from '../../config/index.js';
import type { KvStore } from '../../lib/kv.js';
import type { Logger } from '../../lib/logger.js';
import type { StorageDriver } from '../../lib/storage.js';
import type { Repositories } from '../../repositories/index.js';

const TRENDING_TTL_SEC = 600; // 10 minutes per district (API §3.11)
const BASELINE_MIN_SAMPLES = 20; // fewer samples → `data: null` (API §3.12)

export interface SearchServiceDeps {
  config: Config;
  repos: Repositories;
  kv: KvStore;
  storage: StorageDriver;
  logger: Logger;
}

interface ListingDoc {
  _id: Types.ObjectId;
  title: string;
  price: number;
  condition: string;
  mediaIds?: Types.ObjectId[];
  location?: { district?: string };
  boost?: { active?: boolean; until?: Date | null };
  stats?: { views?: number; chatStarts?: number; favorites?: number };
  createdAt?: Date;
}

interface MediaDoc {
  _id: Types.ObjectId;
  r2Key: string;
  status: string;
}

interface CategoryDoc {
  _id: Types.ObjectId;
  priceBaseline?: { p25?: number; p50?: number; p75?: number } | null;
  updatedAt?: Date;
}

export interface ListingCard {
  id: string;
  title: string;
  price: number;
  condition: string;
  district: string | null;
  heroMediaUrl: string | null;
  boosted: boolean;
  createdAt: string | null;
}

export class SearchService {
  constructor(private readonly deps: SearchServiceDeps) {}

  /**
   * Atlas Search first; on any failure (index missing / cluster tier), fall
   * back to a regex scan so search never 500s (Architecture §3.7, NFR-14).
   */
  async search(query: SearchQuery): Promise<{
    items: ListingCard[];
    page: number;
    limit: number;
    total: number;
    degraded: boolean;
  }> {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(query.limit) || 20));

    if (this.deps.config.ATLAS_SEARCH_ENABLED) {
      try {
        const result = await this.atlasSearch(query, page, limit);
        return { ...result, degraded: false };
      } catch (error) {
        this.deps.logger.warn(
          { err: error instanceof Error ? error.message : error },
          'atlas search failed — serving degraded fallback',
        );
      }
    }

    const result = await this.fallbackSearch(query, page, limit);
    return { ...result, degraded: true };
  }

  /** Top listings per district, cached for 10 minutes (API §3.11). */
  async trending(district: string | undefined, limit: number): Promise<ListingCard[]> {
    const key = `trending:${district ?? 'all'}:${limit}`;
    const cached = await this.deps.kv.get(key);
    if (cached) return JSON.parse(cached) as ListingCard[];

    const filter: Record<string, unknown> = { status: 'active' };
    if (district) filter['location.district'] = district;

    const docs = await this.deps.repos.listings.aggregate<ListingDoc>([
      { $match: filter },
      { $addFields: { rank: boostRank() } },
      { $sort: { rank: 1, 'stats.views': -1, 'stats.chatStarts': -1, createdAt: -1 } },
      { $limit: limit },
    ]);

    const items = await this.toCards(docs);
    await this.deps.kv.set(key, JSON.stringify(items), TRENDING_TTL_SEC);
    return items;
  }

  /** Manual baseline from `categories.priceBaseline`; advisory only. */
  async priceBaseline(categoryId: string, condition?: string) {
    const category = (await this.deps.repos.categories.findById(categoryId)) as
      | CategoryDoc
      | null;
    if (!category?.priceBaseline) return null;

    const filter: Record<string, unknown> = {
      categoryId: new Types.ObjectId(categoryId),
      status: 'active',
    };
    if (condition) filter.condition = condition;
    const sampleSize = await this.deps.repos.listings.count(filter as never);
    if (sampleSize < BASELINE_MIN_SAMPLES) return null;

    return {
      p25: category.priceBaseline.p25 ?? null,
      p50: category.priceBaseline.p50 ?? null,
      p75: category.priceBaseline.p75 ?? null,
      sampleSize,
      updatedAt: category.updatedAt?.toISOString() ?? null,
    };
  }

  // ── Atlas Search ─────────────────────────────────────────────────────────

  private async atlasSearch(query: SearchQuery, page: number, limit: number) {
    const compound: Record<string, unknown> = {
      filter: this.atlasFilters(query),
    };
    if (query.q) {
      compound.must = [
        {
          text: {
            query: query.q,
            path: ['title', 'description'],
            fuzzy: { maxEdits: 1 },
          },
        },
      ];
    }

    const [facet] = await this.deps.repos.listings.aggregate<{
      items: ListingDoc[];
      total: { count: number }[];
    }>([
      {
        $search: {
          index: this.deps.config.ATLAS_SEARCH_INDEX,
          compound,
        },
      },
      { $addFields: { rank: boostRank(), score: { $meta: 'searchScore' } } },
      { $sort: this.sortStage(query.sort, true) },
      {
        $facet: {
          items: [{ $skip: (page - 1) * limit }, { $limit: limit }],
          total: [{ $count: 'count' }],
        },
      },
    ]);

    return {
      items: await this.toCards(facet?.items ?? []),
      page,
      limit,
      total: facet?.total[0]?.count ?? 0,
    };
  }

  private atlasFilters(query: SearchQuery) {
    const filters: Record<string, unknown>[] = [{ term: { path: 'status', value: 'active' } }];
    if (query.categoryId) {
      filters.push({ term: { path: 'categoryId', value: new Types.ObjectId(query.categoryId) } });
    }
    if (query.district) {
      filters.push({ term: { path: 'location.district', value: query.district } });
    }
    if (query.condition) {
      filters.push({ term: { path: 'condition', value: query.condition } });
    }
    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      filters.push({
        range: {
          path: 'price',
          ...(query.minPrice !== undefined ? { gte: query.minPrice } : {}),
          ...(query.maxPrice !== undefined ? { lte: query.maxPrice } : {}),
        },
      });
    }
    return filters;
  }

  // ── Degraded fallback ────────────────────────────────────────────────────

  private async fallbackSearch(query: SearchQuery, page: number, limit: number) {
    const filter: Record<string, unknown> = { status: 'active' };

    if (query.categoryId) filter.categoryId = new Types.ObjectId(query.categoryId);
    if (query.district) filter['location.district'] = query.district;
    if (query.condition) filter.condition = query.condition;
    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      filter.price = {
        ...(query.minPrice !== undefined ? { $gte: query.minPrice } : {}),
        ...(query.maxPrice !== undefined ? { $lte: query.maxPrice } : {}),
      };
    }
    if (query.q) {
      const pattern = new RegExp(escapeRegExp(query.q), 'i');
      filter.$or = [{ title: pattern }, { description: pattern }];
    }

    const [facet] = await this.deps.repos.listings.aggregate<{
      items: ListingDoc[];
      total: { count: number }[];
    }>([
      { $match: filter },
      { $addFields: { rank: boostRank() } },
      { $sort: this.sortStage(query.sort, false) },
      {
        $facet: {
          items: [{ $skip: (page - 1) * limit }, { $limit: limit }],
          total: [{ $count: 'count' }],
        },
      },
    ]);

    return {
      items: await this.toCards(facet?.items ?? []),
      page,
      limit,
      total: facet?.total[0]?.count ?? 0,
    };
  }

  private sortStage(sort: SearchQuery['sort'], atlas: boolean): Record<string, 1 | -1> {
    const boosted: Record<string, 1 | -1> = { rank: 1 };
    if (sort === 'price_asc') return { ...boosted, price: 1 };
    if (sort === 'price_desc') return { ...boosted, price: -1 };
    if (sort === 'date_desc') return { ...boosted, createdAt: -1 };
    return atlas
      ? { ...boosted, score: -1 }
      : { ...boosted, 'stats.views': -1, createdAt: -1 };
  }

  // ── Shared mapping ───────────────────────────────────────────────────────

  private async toCards(docs: ListingDoc[]): Promise<ListingCard[]> {
    if (docs.length === 0) return [];

    const heroIds = docs.map((doc) => doc.mediaIds?.[0]).filter(Boolean) as Types.ObjectId[];
    const media = (await this.deps.repos.mediaObjects.find({
      _id: { $in: heroIds },
    } as never)) as unknown as MediaDoc[];
    const byId = new Map(media.map((item) => [item._id.toString(), item]));

    return Promise.all(
      docs.map(async (doc) => {
        const hero = doc.mediaIds?.[0] ? byId.get(doc.mediaIds[0].toString()) : undefined;
        const boosted = Boolean(
          doc.boost?.active && doc.boost.until && doc.boost.until.getTime() > Date.now(),
        );
        return {
          id: doc._id.toString(),
          title: doc.title,
          price: doc.price,
          condition: doc.condition,
          district: doc.location?.district ?? null,
          heroMediaUrl:
            hero && hero.status === 'clean'
              ? await this.deps.storage.signGet({ key: hero.r2Key, purpose: 'listing', ttlSec: 3600 })
              : null,
          boosted,
          createdAt: doc.createdAt?.toISOString() ?? null,
        };
      }),
    );
  }
}

/** Boosted listings rank above organic results (API §3.9 note). */
function boostRank() {
  return {
    $cond: [
      {
        $and: [
          { $eq: ['$boost.active', true] },
          { $gt: ['$boost.until', new Date()] },
        ],
      },
      0,
      1,
    ],
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
