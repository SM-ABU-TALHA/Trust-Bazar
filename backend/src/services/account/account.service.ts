import { Types } from 'mongoose';
import {
  isBannedDisplayName,
  LIMITS,
} from '@trust/shared/constants';
import type {
  DeleteAccountInput,
  NotificationPrefsInput,
  SavedSearchInput,
  SellerPrefsInput,
  UpdateProfileInput,
} from '@trust/shared/schemas';
import { err } from '../../lib/errors.js';
import type { Repositories } from '../../repositories/index.js';
import type { OtpService } from '../auth/otp.service.js';
import { appendAudit } from '../audit/audit.service.js';

const DELETION_GRACE_DAYS = LIMITS.deletion.graceDays;
const SAVED_SEARCH_LIMIT = 20;

interface UserDoc {
  _id: Types.ObjectId;
  phone: string;
  roles: string[];
  profile?: {
    displayName?: string;
    photoMediaId?: Types.ObjectId | null;
    memberSince?: Date;
    sellerStats?: Record<string, number>;
  };
  sellerPrefs?: { showPhonePublic?: boolean };
  notificationPrefs?: {
    push?: boolean;
    sms?: boolean;
    digest?: boolean;
    lang?: 'bn' | 'en';
  };
  enforcement?: { state?: string; until?: Date; reasonCode?: string };
  deletedAt?: Date | null;
  purgeAt?: Date | null;
  createdAt?: Date;
}

interface MediaDoc {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  purpose: string;
  status: string;
}

interface ListingDoc {
  _id: Types.ObjectId;
  title?: string;
  price?: number;
  status?: string;
  mediaIds?: Types.ObjectId[];
  location?: { district?: string };
  sellerId?: Types.ObjectId;
}

export interface AccountServiceDeps {
  repos: Repositories;
  otp: OtpService;
}

/** Profile, preferences, deletion grace, favorites and saved searches. */
export class AccountService {
  constructor(private readonly deps: AccountServiceDeps) {}

  async getMe(userId: string) {
    const user = await this.requireUser(userId);
    return this.view(user);
  }

  async updateProfile(userId: string, input: UpdateProfileInput) {
    const { repos } = this.deps;
    const user = await this.requireUser(userId);
    const set: Record<string, unknown> = {};

    if (input.displayName !== undefined) {
      if (isBannedDisplayName(input.displayName)) {
        throw err.validation([
          { field: 'displayName', code: 'custom', message: 'display_name_not_allowed' },
        ]);
      }
      set['profile.displayName'] = input.displayName;
    }

    if (input.photoMediaId !== undefined) {
      const media = (await repos.mediaObjects.findById(input.photoMediaId)) as MediaDoc | null;
      if (
        !media ||
        media.ownerId.toString() !== userId ||
        media.purpose !== 'profile'
      ) {
        throw err.notFound('media_not_found');
      }
      if (media.status !== 'clean') throw err.businessRule('media_not_clean');
      set['profile.photoMediaId'] = new Types.ObjectId(input.photoMediaId);
    }

    await repos.users.raw.updateOne({ _id: user._id }, { $set: set });
    return this.getMe(userId);
  }

  async updateSellerPrefs(userId: string, input: SellerPrefsInput) {
    const { repos } = this.deps;
    const user = await this.requireUser(userId);
    await repos.users.raw.updateOne(
      { _id: user._id },
      { $set: { 'sellerPrefs.showPhonePublic': input.showPhonePublic } },
    );
    return this.getMe(userId);
  }

  async updateNotificationPrefs(userId: string, input: NotificationPrefsInput) {
    const { repos } = this.deps;
    const user = await this.requireUser(userId);
    await repos.users.raw.updateOne(
      { _id: user._id },
      {
        $set: {
          'notificationPrefs.push': input.push,
          'notificationPrefs.sms': input.sms,
          'notificationPrefs.digest': input.digest,
          'notificationPrefs.lang': input.lang,
        },
      },
    );
    return this.getMe(userId);
  }

  /**
   * Re-OTP protected deletion (PRD §3.1.7): 14-day grace, sessions revoked,
   * live listings delisted and threads archived immediately.
   */
  async requestDeletion(
    userId: string,
    input: DeleteAccountInput,
    context: { ip?: string },
  ) {
    const { repos, otp } = this.deps;
    const user = await this.requireUser(userId);

    const verified = await otp.verify(input.otpId, input.code);
    if (verified.phone !== user.phone) throw err.businessRule('otp_phone_mismatch');

    const now = new Date();
    const purgeAt = new Date(now.getTime() + DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000);

    await repos.users.raw.updateOne(
      { _id: user._id },
      { $set: { deletedAt: now, purgeAt, sessions: [] } },
    );

    await repos.listings.raw.updateMany(
      { sellerId: user._id, status: { $in: ['active', 'pendingConfirm'] } },
      { $set: { status: 'delisted' } },
    );
    await repos.threads.raw.updateMany(
      { $or: [{ buyerId: user._id }, { sellerId: user._id }] },
      { $set: { state: 'archived' } },
    );

    await repos.consents.insert({
      userId: user._id,
      doc: 'deletion',
      version: 'v1',
      grantedAt: now,
      ip: context.ip,
    } as never);
    await repos.securityEvents.insert({
      userId: user._id,
      type: 'accountDelete',
      meta: { purgeAt: purgeAt.toISOString() },
      at: now,
    } as never);

    await appendAudit(repos, {
      actor: 'user',
      actorId: userId,
      action: 'account.delete',
      entityType: 'users',
      entityId: userId,
      after: { purgeAt: purgeAt.toISOString() },
    });

    return { purgeAt: purgeAt.toISOString(), graceDays: DELETION_GRACE_DAYS };
  }

  /**
   * Cancel is OTP-based on purpose: deletion revokes every session, so a
   * logged-in-only endpoint would lock the user out of their own undo.
   */
  async cancelDeletion(input: DeleteAccountInput) {
    const { repos, otp } = this.deps;
    const verified = await otp.verify(input.otpId, input.code);
    const user = (await repos.users.findByPhone(verified.phone)) as UserDoc | null;
    if (!user) throw err.notFound('user_not_found');
    if (!user.deletedAt) throw err.businessRule('account_not_pending_deletion');

    await repos.users.raw.updateOne(
      { _id: user._id },
      { $unset: { deletedAt: '', purgeAt: '' } },
    );
    await repos.securityEvents.insert({
      userId: user._id,
      type: 'accountRestore',
      meta: {},
      at: new Date(),
    } as never);

    return { restored: true };
  }

  // ── Favorites ────────────────────────────────────────────────────────────

  async addFavorite(userId: string, listingId: string) {
    const { repos } = this.deps;
    const listing = (await repos.listings.findById(listingId)) as ListingDoc | null;
    if (!listing || listing.status === 'draft') throw err.notFound('listing_not_found');

    const result = await repos.favorites.raw.updateOne(
      { userId: new Types.ObjectId(userId), listingId: new Types.ObjectId(listingId) },
      { $setOnInsert: { createdAt: new Date() } },
      { upsert: true },
    );
    if (result.upsertedCount > 0) {
      await repos.listings.raw.updateOne({ _id: listing._id }, { $inc: { 'stats.favorites': 1 } });
    }
    return { favorited: true };
  }

  async removeFavorite(userId: string, listingId: string) {
    const { repos } = this.deps;
    const removed = await repos.favorites.raw.findOneAndDelete({
      userId: new Types.ObjectId(userId),
      listingId: new Types.ObjectId(listingId),
    });
    if (removed) {
      await repos.listings.raw.updateOne(
        { _id: new Types.ObjectId(listingId), 'stats.favorites': { $gt: 0 } },
        { $inc: { 'stats.favorites': -1 } },
      );
    }
    return { favorited: false };
  }

  async listFavorites(userId: string, page: number, limit: number) {
    const { repos } = this.deps;
    const paged = await repos.favorites.paginate(
      { userId: new Types.ObjectId(userId) } as never,
      { page, limit },
      { sort: { createdAt: -1 } },
    );
    const ids = (paged.items as Array<{ listingId: Types.ObjectId }>).map((item) => item.listingId);
    const listings =
      ids.length > 0
        ? ((await repos.listings.find({ _id: { $in: ids } } as never)) as unknown as ListingDoc[])
        : [];
    const byId = new Map(listings.map((listing) => [listing._id.toString(), listing]));

    return {
      items: ids
        .map((id) => byId.get(id.toString()))
        .filter((listing): listing is ListingDoc => Boolean(listing))
        .map((listing) => ({
          id: listing._id.toString(),
          title: listing.title ?? '',
          price: listing.price ?? 0,
          status: listing.status ?? 'active',
          district: listing.location?.district ?? '',
          heroMediaId: listing.mediaIds?.[0]?.toString() ?? null,
        })),
      page: paged.page,
      limit: paged.limit,
      total: paged.total,
    };
  }

  // ── Saved searches ───────────────────────────────────────────────────────

  async listSavedSearches(userId: string) {
    const { repos } = this.deps;
    const rows = await repos.savedSearches.find(
      { userId: new Types.ObjectId(userId) } as never,
      { sort: { createdAt: -1 }, limit: SAVED_SEARCH_LIMIT },
    );
    return rows.map((row) => this.savedSearchView(row as unknown as SavedSearchDoc));
  }

  async createSavedSearch(userId: string, input: SavedSearchInput) {
    const { repos } = this.deps;
    const count = await repos.savedSearches.count({
      userId: new Types.ObjectId(userId),
    } as never);
    if (count >= SAVED_SEARCH_LIMIT) throw err.businessRule('saved_search_limit');

    const created = await repos.savedSearches.insert({
      userId: new Types.ObjectId(userId),
      query: input.query,
      filters: input.filters,
      frequency: input.frequency,
      lastNotifiedAt: null,
    } as never);
    return this.savedSearchView(created as unknown as SavedSearchDoc);
  }

  async deleteSavedSearch(userId: string, id: string) {
    const { repos } = this.deps;
    const removed = await repos.savedSearches.raw.findOneAndDelete({
      _id: new Types.ObjectId(id),
      userId: new Types.ObjectId(userId),
    });
    if (!removed) throw err.notFound('saved_search_not_found');
    return { deleted: true };
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private async requireUser(userId: string): Promise<UserDoc> {
    const user = (await this.deps.repos.users.findById(userId)) as UserDoc | null;
    if (!user) throw err.tokenRevoked('User no longer exists');
    return user;
  }

  private view(user: UserDoc) {
    return {
      id: user._id.toString(),
      phone: user.phone,
      roles: user.roles,
      profile: {
        displayName: user.profile?.displayName ?? null,
        photoMediaId: user.profile?.photoMediaId?.toString() ?? null,
        memberSince: user.profile?.memberSince ?? user.createdAt ?? null,
        sellerStats: user.profile?.sellerStats ?? {
          activeListings: 0,
          confirmedDeals: 0,
          disputes90d: 0,
        },
      },
      sellerPrefs: { showPhonePublic: user.sellerPrefs?.showPhonePublic ?? true },
      notificationPrefs: {
        push: user.notificationPrefs?.push ?? true,
        sms: user.notificationPrefs?.sms ?? true,
        digest: user.notificationPrefs?.digest ?? false,
        lang: user.notificationPrefs?.lang ?? 'bn',
      },
      enforcement: {
        state: user.enforcement?.state ?? 'none',
        ...(user.enforcement?.until ? { until: user.enforcement.until.toISOString() } : {}),
        ...(user.enforcement?.reasonCode ? { reasonCode: user.enforcement.reasonCode } : {}),
      },
      deletion: user.deletedAt
        ? { scheduledAt: user.deletedAt.toISOString(), purgeAt: user.purgeAt?.toISOString() ?? null }
        : null,
    };
  }

  private savedSearchView(row: SavedSearchDoc) {
    return {
      id: row._id.toString(),
      query: row.query,
      filters: row.filters ?? {},
      frequency: row.frequency ?? 'daily',
      createdAt: (row as { createdAt?: Date }).createdAt?.toISOString() ?? null,
    };
  }
}

interface SavedSearchDoc {
  _id: Types.ObjectId;
  query: string;
  filters?: Record<string, unknown>;
  frequency?: string;
}
