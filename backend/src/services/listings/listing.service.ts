import { Types } from 'mongoose';
import { LIMITS, findProhibitedTerms } from '@trust/shared/constants';
import type {
  CreateListingInput,
  MarkSoldInput,
  MyListingsQuery,
  UpdateListingInput,
} from '@trust/shared/schemas';
import { err } from '../../lib/errors.js';
import type { StorageDriver } from '../../lib/storage.js';
import type { Repositories } from '../../repositories/index.js';
import { appendAudit } from '../audit/audit.service.js';

const EXPIRY_MS = LIMITS.listing.expiryDays * 86_400_000;
const ACTIVE_CAP = LIMITS.listing.freeActiveCap;
const UNDO_MS = LIMITS.deal.undoMinutes * 60_000;
const CONFIRM_WINDOW_MS = LIMITS.deal.confirmWindowDays * 86_400_000;

/** Publicly readable — drafts and removed listings stay invisible (API §3.8). */
const PUBLIC_STATUSES = ['active', 'pendingConfirm', 'sold'] as const;
/** Editing is only meaningful while the ad is alive (or a draft). */
const EDITABLE_STATUSES = ['draft', 'active', 'expired'] as const;

interface ListingDoc {
  _id: Types.ObjectId;
  sellerId: Types.ObjectId;
  categoryId: Types.ObjectId;
  title: string;
  description: string;
  price: number;
  condition: string;
  mediaIds: Types.ObjectId[];
  pHashes?: string[];
  location?: { district?: string; geo?: { type?: string; coordinates?: number[] } };
  status: string;
  boost?: { active?: boolean; until?: Date | null };
  priceFlags?: { tooLow?: boolean; tooHigh?: boolean };
  stats?: { views?: number; chatStarts?: number; callTaps?: number; favorites?: number };
  expiresAt?: Date | null;
  version?: number;
  aiScan?: { status?: string; flags?: string[] };
  createdAt?: Date;
  updatedAt?: Date;
}

interface MediaDoc {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  purpose: string;
  status: string;
  r2Key: string;
  pHash?: string;
  width?: number;
  height?: number;
}

interface CategoryDoc {
  _id: Types.ObjectId;
  name?: { bn?: string; en?: string };
  slug?: string;
  priceBaseline?: { p25?: number; p50?: number; p75?: number } | null;
}

interface SellerDoc {
  _id: Types.ObjectId;
  roles?: string[];
  profile?: { displayName?: string; memberSince?: Date };
  enforcement?: { state?: string };
  deletedAt?: Date | null;
}

interface ThreadDoc {
  _id: Types.ObjectId;
  listingId: Types.ObjectId;
  sellerId: Types.ObjectId;
  buyerId: Types.ObjectId;
  state: string;
  buyerMsgCount?: number;
}

interface DealDoc {
  _id: Types.ObjectId;
  listingId: Types.ObjectId;
  sellerId: Types.ObjectId;
  buyerId?: Types.ObjectId | null;
  type: string;
  channel: string;
  undoUntil?: Date | null;
  confirmedAt?: Date | null;
  disputeRef?: Types.ObjectId | null;
}

export interface ListingServiceDeps {
  repos: Repositories;
  storage: StorageDriver;
}

export class ListingService {
  private geoCache: { districts: string[]; expiresAt: number } | null = null;

  constructor(private readonly deps: ListingServiceDeps) {}

  /** Geo-launch allowlist (config/geoLaunch): empty = all 64 districts open. */
  private async assertGeoLaunch(district: string) {
    if (this.geoCache && this.geoCache.expiresAt > Date.now()) {
      if (this.geoCache.districts.length > 0 && !this.geoCache.districts.includes(district)) {
        throw err.businessRule('district_not_launched');
      }
      return;
    }

    const doc = (await this.deps.repos.config.findOne({
      _id: 'geoLaunch',
    } as never)) as unknown as { value?: { districts?: string[] } } | null;
    const districts = doc?.value?.districts ?? [];
    this.geoCache = { districts, expiresAt: Date.now() + 60_000 };
    if (districts.length > 0 && !districts.includes(district)) {
      throw err.businessRule('district_not_launched');
    }
  }

  // ── Drafts ───────────────────────────────────────────────────────────────

  async create(sellerId: string, input: CreateListingInput) {
    const { repos } = this.deps;
    await this.assertCategory(input.categoryId);
    await this.assertGeoLaunch(input.district);
    const media = await this.requireMedia(sellerId, input.mediaIds);
    const pHashes = media.map((item) => item.pHash).filter((hash): hash is string => Boolean(hash));
    const flags = await this.computeFlags({
      title: input.title,
      description: input.description,
      pHashes,
    });

    const now = new Date();
    const created = (await repos.listings.insert({
      sellerId: new Types.ObjectId(sellerId),
      categoryId: new Types.ObjectId(input.categoryId),
      title: input.title,
      description: input.description,
      price: input.price,
      condition: input.condition,
      mediaIds: input.mediaIds.map((id) => new Types.ObjectId(id)),
      pHashes,
      location: buildLocation(input.district, input.geo?.coordinates),
      status: 'draft',
      priceFlags: await this.priceFlags(input.price, input.categoryId),
      stats: { views: 0, chatStarts: 0, callTaps: 0, favorites: 0 },
      expiresAt: new Date(now.getTime() + EXPIRY_MS),
      version: 0,
      aiScan: { status: 'queued', flags },
    } as never)) as unknown as ListingDoc;

    await appendAudit(repos, {
      actor: 'user',
      actorId: sellerId,
      action: 'listing.created',
      entityType: 'listings',
      entityId: created._id.toString(),
      after: { status: 'draft', flags },
    });

    return {
      id: created._id.toString(),
      status: created.status,
      expiresAt: created.expiresAt?.toISOString() ?? null,
      version: created.version ?? 0,
      aiScan: { status: created.aiScan?.status ?? 'queued', flags: created.aiScan?.flags ?? [] },
    };
  }

  // ── Publish / lifecycle ──────────────────────────────────────────────────

  async publish(sellerId: string, listingId: string) {
    const { repos } = this.deps;
    const listing = await this.requireOwned(listingId, sellerId);

    if (listing.status === 'active') throw err.conflict('already_published');
    if (!['draft', 'expired'].includes(listing.status)) {
      throw err.conflict('listing_not_publishable');
    }

    const active = await repos.listings.count({
      sellerId: new Types.ObjectId(sellerId),
      status: 'active',
    } as never);
    if (active >= ACTIVE_CAP) throw err.businessRule('active_listing_limit');

    const media = await this.mediaFor(listing.mediaIds);
    const heroId = listing.mediaIds[0];
    if (!heroId) throw err.businessRule('media_required');
    const hero = media.find((item) => item._id.equals(heroId));
    if (!hero) throw err.businessRule('media_required');
    if (hero.status !== 'clean') throw err.businessRule('hero_not_clean');
    if (hero.purpose !== 'listing') throw err.businessRule('invalid_media_purpose');

    const expiresAt = new Date(Date.now() + EXPIRY_MS);
    const updated = (await repos.listings.findOneAndUpdate(
      { _id: listing._id, sellerId: new Types.ObjectId(sellerId), status: listing.status } as never,
      {
        $set: {
          status: 'active',
          expiresAt,
          priceFlags: await this.priceFlags(listing.price, String(listing.categoryId)),
        },
        $inc: { version: 1 },
      } as never,
    )) as ListingDoc | null;
    if (!updated) throw err.conflict('listing_state_changed');

    await appendAudit(repos, {
      actor: 'user',
      actorId: sellerId,
      action: 'listing.published',
      entityType: 'listings',
      entityId: listing._id.toString(),
      after: { status: 'active', expiresAt: expiresAt.toISOString() },
    });

    return {
      id: listing._id.toString(),
      status: 'active',
      expiresAt: expiresAt.toISOString(),
      version: updated.version ?? (listing.version ?? 0) + 1,
    };
  }

  async update(sellerId: string, listingId: string, input: UpdateListingInput) {
    const { repos } = this.deps;
    const listing = await this.requireOwned(listingId, sellerId);
    if (!(EDITABLE_STATUSES as readonly string[]).includes(listing.status)) {
      throw err.conflict('listing_not_editable');
    }

    const $set: Record<string, unknown> = {};
    let media: MediaDoc[] | null = null;

    if (input.mediaIds) {
      media = await this.requireMedia(sellerId, input.mediaIds);
      $set.mediaIds = input.mediaIds.map((id) => new Types.ObjectId(id));
      $set.pHashes = media
        .map((item) => item.pHash)
        .filter((hash): hash is string => Boolean(hash));
    }
    if (input.title !== undefined) $set.title = input.title;
    if (input.description !== undefined) $set.description = input.description;
    if (input.price !== undefined) $set.price = input.price;
    if (input.condition !== undefined) $set.condition = input.condition;
    if (input.categoryId !== undefined) {
      await this.assertCategory(input.categoryId);
      $set.categoryId = new Types.ObjectId(input.categoryId);
    }
    const district = input.district ?? listing.location?.district;
    if (input.district !== undefined || input.geo !== undefined) {
      if (input.district !== undefined) await this.assertGeoLaunch(input.district);
      $set.location = buildLocation(
        district ?? '',
        input.geo?.coordinates ?? listing.location?.geo?.coordinates,
      );
    }

    const title = input.title ?? listing.title;
    const description = input.description ?? listing.description;
    const price = input.price ?? listing.price;
    const categoryId = input.categoryId ?? String(listing.categoryId);
    const pHashes =
      ($set.pHashes as string[] | undefined) ?? listing.pHashes ?? [];

    $set.aiScan = {
      status: 'queued',
      flags: await this.computeFlags({
        title,
        description,
        pHashes,
        excludeId: listing._id.toString(),
      }),
    };
    if (input.price !== undefined || input.categoryId !== undefined) {
      $set.priceFlags = await this.priceFlags(price, categoryId);
    }

    // The `version` guard lives inside the filter — a stale write matches
    // nothing, so no partial update is ever applied.
    const updated = (await repos.listings.findOneAndUpdate(
      {
        _id: listing._id,
        sellerId: new Types.ObjectId(sellerId),
        version: input.version,
      } as never,
      { $set, $inc: { version: 1 } } as never,
    )) as ListingDoc | null;
    if (!updated) throw err.conflict('version_conflict');

    await appendAudit(repos, {
      actor: 'user',
      actorId: sellerId,
      action: 'listing.updated',
      entityType: 'listings',
      entityId: listing._id.toString(),
      before: { version: input.version },
      after: { version: updated.version ?? input.version + 1, fields: Object.keys($set) },
    });

    return this.summary(updated);
  }

  async delist(sellerId: string, listingId: string): Promise<void> {
    const { repos } = this.deps;
    const listing = await this.requireOwned(listingId, sellerId);
    if (listing.status === 'sold' || listing.status === 'pendingConfirm') {
      throw err.conflict('listing_in_deal');
    }

    await repos.listings.updateOne(
      { _id: listing._id, sellerId: new Types.ObjectId(sellerId) } as never,
      { $set: { status: 'delisted' }, $inc: { version: 1 } } as never,
    );
    await appendAudit(repos, {
      actor: 'user',
      actorId: sellerId,
      action: 'listing.delisted',
      entityType: 'listings',
      entityId: listing._id.toString(),
    });
  }

  async renew(sellerId: string, listingId: string) {
    const { repos } = this.deps;
    const listing = await this.requireOwned(listingId, sellerId);
    if (!['active', 'expired'].includes(listing.status)) {
      throw err.conflict('listing_not_renewable');
    }

    if (listing.status === 'expired') {
      const active = await repos.listings.count({
        sellerId: new Types.ObjectId(sellerId),
        status: 'active',
      } as never);
      if (active >= ACTIVE_CAP) throw err.businessRule('active_listing_limit');
    }

    const expiresAt = new Date(Date.now() + EXPIRY_MS);
    const updated = (await repos.listings.findOneAndUpdate(
      { _id: listing._id, sellerId: new Types.ObjectId(sellerId) } as never,
      { $set: { status: 'active', expiresAt }, $inc: { version: 1 } } as never,
    )) as ListingDoc | null;
    if (!updated) throw err.conflict('listing_state_changed');

    await appendAudit(repos, {
      actor: 'user',
      actorId: sellerId,
      action: 'listing.renewed',
      entityType: 'listings',
      entityId: listing._id.toString(),
      after: { expiresAt: expiresAt.toISOString() },
    });

    return { id: listing._id.toString(), status: 'active', expiresAt: expiresAt.toISOString() };
  }

  // ── Deals ────────────────────────────────────────────────────────────────

  async markSold(sellerId: string, listingId: string, input: MarkSoldInput) {
    const { repos } = this.deps;
    const listing = await this.requireOwned(listingId, sellerId);
    if (listing.status !== 'active') throw err.conflict('listing_not_active');

    const existing = (await repos.deals.findOne({
      listingId: listing._id,
    } as never)) as DealDoc | null;
    if (existing) throw err.conflict('already_sold');

    const now = new Date();
    let buyerId: Types.ObjectId | null = null;
    let type: 'unconfirmed' | 'direct' = 'direct';
    let undoUntil: Date | null = null;

    if (input.channel === 'chat') {
      const thread = (await repos.threads.findById(input.threadId as string)) as ThreadDoc | null;
      if (
        !thread ||
        !thread.listingId.equals(listing._id) ||
        !thread.sellerId.equals(new Types.ObjectId(sellerId))
      ) {
        throw err.notFound('thread_not_found');
      }
      if (input.buyerId && thread.buyerId.toString() !== input.buyerId) {
        throw err.businessRule('buyer_mismatch');
      }
      // Anti-gaming (PRD §3.3.13): a confirmed sale needs a real conversation.
      if ((thread.buyerMsgCount ?? 0) < 1) throw err.businessRule('buyer_message_required');

      buyerId = thread.buyerId;
      type = 'unconfirmed';
      undoUntil = new Date(now.getTime() + UNDO_MS);
    } else {
      buyerId = input.buyerId ? new Types.ObjectId(input.buyerId) : null;
      if (buyerId && buyerId.equals(new Types.ObjectId(sellerId))) {
        throw err.businessRule('buyer_cannot_be_seller');
      }
      type = 'direct';
    }

    let deal: DealDoc;
    try {
      deal = (await repos.deals.insert({
        listingId: listing._id,
        sellerId: new Types.ObjectId(sellerId),
        buyerId,
        type,
        channel: input.channel,
        markedSoldAt: now,
        confirmedAt: null,
        expiresAt: new Date(now.getTime() + CONFIRM_WINDOW_MS),
        disputeRef: null,
        undoUntil,
      } as never)) as unknown as DealDoc;
    } catch (error) {
      if ((error as { code?: number }).code === 11000) throw err.conflict('already_sold');
      throw error;
    }

    await repos.listings.updateOne(
      { _id: listing._id } as never,
      {
        $set: { status: type === 'unconfirmed' ? 'pendingConfirm' : 'sold' },
        $inc: { version: 1 },
      } as never,
    );
    await appendAudit(repos, {
      actor: 'user',
      actorId: sellerId,
      action: 'listing.sold',
      entityType: 'deals',
      entityId: deal._id.toString(),
      after: { type, channel: input.channel, undoUntil: undoUntil?.toISOString() ?? null },
    });

    return {
      dealId: deal._id.toString(),
      type,
      undoUntil: undoUntil ? undoUntil.toISOString() : null,
    };
  }

  async undoDeal(sellerId: string, dealId: string) {
    const { repos } = this.deps;
    const deal = (await repos.deals.findById(dealId)) as DealDoc | null;
    if (!deal || !deal.sellerId.equals(new Types.ObjectId(sellerId))) {
      throw err.notFound('deal_not_found');
    }
    if (deal.confirmedAt || deal.disputeRef) throw err.conflict('deal_already_responded');
    if (!deal.undoUntil || Date.now() > deal.undoUntil.getTime()) {
      throw err.conflict('undo_window_expired');
    }

    await repos.deals.deleteOne({ _id: deal._id } as never);
    await repos.listings.updateOne(
      { _id: deal.listingId, status: 'pendingConfirm' } as never,
      { $set: { status: 'active' }, $inc: { version: 1 } } as never,
    );
    await appendAudit(repos, {
      actor: 'user',
      actorId: sellerId,
      action: 'deal.undone',
      entityType: 'deals',
      entityId: deal._id.toString(),
    });

    const listing = (await repos.listings.findById(deal.listingId.toString())) as ListingDoc | null;
    return { listing: { id: deal.listingId.toString(), status: listing?.status ?? 'active' } };
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  /** Public detail — no phone, no PII, banned/deleted sellers hidden. */
  async getPublic(listingId: string) {
    const { repos, storage } = this.deps;
    const listing = (await repos.listings.findById(listingId)) as ListingDoc | null;
    if (!listing || !PUBLIC_STATUSES.includes(listing.status as (typeof PUBLIC_STATUSES)[number])) {
      throw err.notFound('listing_not_found');
    }

    const seller = (await repos.users.findById(listing.sellerId.toString())) as SellerDoc | null;
    if (
      !seller ||
      seller.deletedAt ||
      (seller.enforcement?.state && seller.enforcement.state !== 'none' &&
        seller.enforcement.state !== 'warned')
    ) {
      throw err.notFound('listing_not_found');
    }

    const media = await this.mediaFor(listing.mediaIds);
    const order = new Map(listing.mediaIds.map((id, index) => [id.toString(), index]));
    media.sort((a, b) => (order.get(a._id.toString()) ?? 0) - (order.get(b._id.toString()) ?? 0));
    const mediaView = await Promise.all(
      media.map(async (item) => ({
        id: item._id.toString(),
        url:
          item.status === 'clean'
            ? await storage.signGet({ key: item.r2Key, purpose: 'listing', ttlSec: 3600 })
            : null,
        width: item.width ?? null,
        height: item.height ?? null,
      })),
    );

    await repos.listings.updateOne(
      { _id: listing._id } as never,
      { $inc: { 'stats.views': 1 } } as never,
    );

    return {
      id: listing._id.toString(),
      title: listing.title,
      description: listing.description,
      price: listing.price,
      condition: listing.condition,
      status: listing.status,
      categoryId: listing.categoryId.toString(),
      district: listing.location?.district ?? null,
      geo: listing.location?.geo ?? null,
      media: mediaView,
      seller: {
        id: seller._id.toString(),
        displayName: seller.profile?.displayName ?? null,
        memberSince: seller.profile?.memberSince?.toISOString() ?? null,
        verified: (seller.roles ?? []).includes('verifiedBuyer'),
      },
      stats: { views: (listing.stats?.views ?? 0) + 1 },
      boost: { active: Boolean(listing.boost?.active) },
      aiScan: { status: listing.aiScan?.status ?? 'queued' },
      expiresAt: listing.expiresAt?.toISOString() ?? null,
      createdAt: listing.createdAt?.toISOString() ?? null,
    };
  }

  async listMine(sellerId: string, query: MyListingsQuery) {
    const { repos } = this.deps;
    const filter: Record<string, unknown> = { sellerId: new Types.ObjectId(sellerId) };
    if (query.status) filter.status = query.status;

    const page = await repos.listings.paginate(filter as never, {
      page: query.page,
      limit: query.limit,
    }, { sort: { createdAt: -1 } });

    return {
      items: page.items.map((item) => this.summary(item as unknown as ListingDoc)),
      page: page.page,
      limit: page.limit,
      total: page.total,
    };
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private async requireOwned(listingId: string, sellerId: string): Promise<ListingDoc> {
    const listing = (await this.deps.repos.listings.findById(listingId)) as ListingDoc | null;
    // IDOR-safe: a non-owner gets the same 404 as a missing listing.
    if (!listing || !listing.sellerId.equals(new Types.ObjectId(sellerId))) {
      throw err.notFound('listing_not_found');
    }
    return listing;
  }

  private async assertCategory(categoryId: string): Promise<CategoryDoc> {
    const category = (await this.deps.repos.categories.findById(categoryId)) as CategoryDoc | null;
    if (!category) {
      throw err.validation([{ field: 'categoryId', code: 'custom', message: 'invalid_category' }]);
    }
    const children = await this.deps.repos.categories.count({ parentId: category._id } as never);
    if (children > 0) {
      throw err.validation([
        { field: 'categoryId', code: 'custom', message: 'category_not_leaf' },
      ]);
    }
    return category;
  }

  private async requireMedia(sellerId: string, ids: string[]): Promise<MediaDoc[]> {
    const unique = [...new Set(ids)];
    const media = (await this.deps.repos.mediaObjects.find({
      _id: { $in: unique.map((id) => new Types.ObjectId(id)) },
    } as never)) as unknown as MediaDoc[];

    if (media.length !== unique.length) {
      throw err.validation([{ field: 'mediaIds', code: 'custom', message: 'media_not_found' }]);
    }
    for (const item of media) {
      if (!item.ownerId.equals(new Types.ObjectId(sellerId)) || item.purpose !== 'listing') {
        throw err.validation([{ field: 'mediaIds', code: 'custom', message: 'media_not_owned' }]);
      }
      if (item.status === 'quarantined') {
        throw err.validation([{ field: 'mediaIds', code: 'custom', message: 'media_quarantined' }]);
      }
    }
    return media;
  }

  private mediaFor(ids: Types.ObjectId[]): Promise<MediaDoc[]> {
    return this.deps.repos.mediaObjects.find({
      _id: { $in: ids },
    } as never) as unknown as Promise<MediaDoc[]>;
  }

  /** Price baseline is advisory only — it never blocks a publish (PRD §3.3.4). */
  private async priceFlags(price: number, categoryId: string) {
    const category = (await this.deps.repos.categories.findById(categoryId)) as CategoryDoc | null;
    const baseline = category?.priceBaseline ?? null;
    return {
      tooLow: baseline?.p25 !== undefined && price < baseline.p25,
      tooHigh: baseline?.p75 !== undefined && price > baseline.p75,
    };
  }

  private async computeFlags(input: {
    title: string;
    description: string;
    pHashes: string[];
    excludeId?: string;
  }): Promise<string[]> {
    const flags: string[] = findProhibitedTerms(`${input.title} ${input.description}`).map(
      (term) => `prohibitedTerm:${term}`,
    );

    if (input.pHashes.length > 0) {
      const match = await this.deps.repos.listings.findOne({
        pHashes: { $in: input.pHashes },
        status: { $in: ['active', 'pendingConfirm'] },
        ...(input.excludeId ? { _id: { $ne: new Types.ObjectId(input.excludeId) } } : {}),
      } as never);
      if (match) flags.push('duplicateImage');
    }
    return flags;
  }

  private summary(listing: ListingDoc) {
    return {
      id: listing._id.toString(),
      title: listing.title,
      price: listing.price,
      condition: listing.condition,
      status: listing.status,
      district: listing.location?.district ?? null,
      mediaIds: (listing.mediaIds ?? []).map((id) => id.toString()),
      stats: {
        views: listing.stats?.views ?? 0,
        chatStarts: listing.stats?.chatStarts ?? 0,
        callTaps: listing.stats?.callTaps ?? 0,
        favorites: listing.stats?.favorites ?? 0,
      },
      boost: { active: Boolean(listing.boost?.active) },
      version: listing.version ?? 0,
      priceFlags: listing.priceFlags ?? { tooLow: false, tooHigh: false },
      aiScan: { status: listing.aiScan?.status ?? 'queued', flags: listing.aiScan?.flags ?? [] },
      expiresAt: listing.expiresAt?.toISOString() ?? null,
      createdAt: listing.createdAt?.toISOString() ?? null,
      updatedAt: listing.updatedAt?.toISOString() ?? null,
    };
  }
}

/** `location` is always present; `geo` only when the client sent coordinates. */
function buildLocation(district: string, coordinates?: number[]) {
  return {
    district,
    ...(coordinates ? { geo: { type: 'Point' as const, coordinates } } : {}),
  };
}
