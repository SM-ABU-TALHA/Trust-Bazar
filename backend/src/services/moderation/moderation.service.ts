import { Types } from 'mongoose';
import { LIMITS, SUSPENSION_DAYS } from '@trust/shared/constants';
import type {
  AppealInput,
  ReportInput,
  SupportTicketInput,
  TicketMessageInput,
} from '@trust/shared/schemas';
import { err } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import type { Repositories } from '../../repositories/index.js';
import { appendAudit } from '../audit/audit.service.js';
import type { NotificationService } from '../notifications/notification.service.js';
import type { PaymentService } from '../payments/payment.service.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const CLAIM_LOCK_MS = 5 * 60_000;

interface ReportDoc {
  _id: Types.ObjectId;
  reporterId: Types.ObjectId;
  targetType: 'listing' | 'user' | 'message';
  targetId: Types.ObjectId;
  category: string;
  details: string;
  status: string;
}

interface CaseDoc {
  _id: Types.ObjectId;
  source: string;
  refId: Types.ObjectId;
  status: string;
  claimedBy?: Types.ObjectId | null;
  lockUntil?: Date | null;
  slaDue: Date;
  action?: string | null;
  pendingBan?: { proposedBy?: Types.ObjectId | null; reasonCode?: string | null };
  banApprovals?: { by: Types.ObjectId; at: Date }[];
}

interface AppealDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  referenceId?: Types.ObjectId | null;
  type: 'kyc' | 'enforcement' | 'delisting';
  body: string;
  status: string;
  outcome?: string | null;
  slaDue: Date;
  resolutionNote?: string | null;
}

interface TicketDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  subject: string;
  status: string;
  messages: { _id: Types.ObjectId; authorType: string; body: string; at: Date }[];
  slaDue: Date;
}

interface UserDoc {
  _id: Types.ObjectId;
  roles?: string[];
  enforcement?: {
    state?: string;
    until?: Date | null;
    reasonCode?: string | null;
    history?: Record<string, unknown>[];
  };
  nidHash?: string;
}

export class ModerationService {
  constructor(
    private readonly deps: {
      repos: Repositories;
      notifications: NotificationService;
      payments: PaymentService;
      logger: Logger;
    },
  ) {}

  private get repos(): Repositories {
    return this.deps.repos;
  }

  // ── Reports & cases ────────────────────────────────────────────────────────

  async createReport(userId: string, input: ReportInput) {
    const since = new Date(Date.now() - DAY);
    const today = await this.repos.reports.count({
      reporterId: new Types.ObjectId(userId),
      createdAt: { $gte: since },
    } as never);
    if (today >= (LIMITS.report?.maxPerDay ?? 5)) throw err.rateLimited(DAY / 1000);

    const duplicate = (await this.repos.reports.findOne({
      reporterId: new Types.ObjectId(userId),
      targetType: input.targetType,
      targetId: new Types.ObjectId(input.targetId),
      status: { $in: ['open', 'reviewing'] },
    } as never)) as unknown as ReportDoc | null;
    if (duplicate) return { reportId: String(duplicate._id), merged: true };

    const report = (await this.repos.reports.insert({
      reporterId: new Types.ObjectId(userId),
      targetType: input.targetType,
      targetId: new Types.ObjectId(input.targetId),
      category: input.category,
      details: input.comment ?? input.category,
      status: 'open',
    } as never)) as unknown as ReportDoc;

    const existingCase = (await this.repos.moderationCases.findOne({
      source: 'report',
      refId: new Types.ObjectId(input.targetId),
      status: { $ne: 'closed' },
    } as never)) as unknown as CaseDoc | null;

    let caseId = existingCase?._id;
    if (!caseId) {
      const created = (await this.repos.moderationCases.insert({
        source: 'report',
        refId: new Types.ObjectId(input.targetId),
        status: 'open',
        slaDue: new Date(Date.now() + 48 * HOUR),
        snapshot: await this.buildSnapshot(input.targetType, input.targetId),
      } as never)) as unknown as CaseDoc;
      caseId = created._id;
    }

    await this.deps.notifications.emit({
      userId,
      event: 'report.received',
      payload: { category: input.category },
      dedupeKey: `report.received:${String(report._id)}`,
    });
    await appendAudit(this.repos, {
      actor: 'user',
      actorId: userId,
      action: 'report.create',
      entityType: 'moderationCase',
      entityId: String(caseId),
      after: { targetType: input.targetType, category: input.category },
    });

    return { reportId: String(report._id), caseId: String(caseId), merged: false };
  }

  private async buildSnapshot(targetType: string, targetId: string) {
    if (targetType === 'listing') {
      const listing = (await this.repos.listings.findById(targetId)) as unknown as {
        title?: string;
        status?: string;
        sellerId?: Types.ObjectId;
      } | null;
      return listing ? { title: listing.title, status: listing.status, sellerId: listing.sellerId } : null;
    }
    if (targetType === 'message') {
      const message = (await this.repos.messages.findById(targetId)) as unknown as {
        body?: string;
        senderId?: Types.ObjectId;
        threadId?: Types.ObjectId;
      } | null;
      return message
        ? { body: message.body, senderId: message.senderId, threadId: message.threadId }
        : null;
    }
    const user = (await this.repos.users.findById(targetId)) as unknown as UserDoc | null;
    return user ? { enforcement: user.enforcement?.state ?? 'none' } : null;
  }

  /** Queue view; `claim=true` claims up to `limit` unlocked cases for 5 minutes. */
  async listCases(operatorId: string, status: string | undefined, claim: boolean) {
    const now = new Date();
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    else filter.status = { $ne: 'closed' };
    if (claim) {
      filter.$or = [
        { claimedBy: null },
        { lockUntil: null },
        { lockUntil: { $lt: now } },
        { claimedBy: new Types.ObjectId(operatorId) },
      ];
    }

    const cases = await this.repos.moderationCases.find(filter as never, {
      sort: { slaDue: 1 },
      limit: 50,
    });

    if (claim) {
      await Promise.all(
        cases.map((item) => {
          const doc = item as unknown as CaseDoc;
          return this.repos.moderationCases.findOneAndUpdate(
            { _id: doc._id } as never,
            {
              $set: {
                claimedBy: new Types.ObjectId(operatorId),
                lockUntil: new Date(Date.now() + CLAIM_LOCK_MS),
                status: 'claimed',
              },
            } as never,
          );
        }),
      );
    }

    return cases.map((item) => this.presentCase(item as unknown as CaseDoc));
  }

  presentCase(doc: CaseDoc) {
    return {
      id: String(doc._id),
      source: doc.source,
      status: doc.status,
      slaDue: doc.slaDue,
      slaState: doc.slaDue.getTime() < Date.now() ? 'breached' : 'ok',
      claimedBy: doc.claimedBy ? String(doc.claimedBy) : null,
      lockUntil: doc.lockUntil ?? null,
      snapshot: (doc as unknown as { snapshot?: unknown }).snapshot ?? null,
    };
  }

  async claimCase(operatorId: string, caseId: string) {
    const now = new Date();
    const claimed = await this.repos.moderationCases.findOneAndUpdate(
      {
        _id: new Types.ObjectId(caseId),
        status: { $ne: 'closed' },
        $or: [
          { claimedBy: null },
          { lockUntil: null },
          { lockUntil: { $lt: now } },
          { claimedBy: new Types.ObjectId(operatorId) },
        ],
      } as never,
      {
        $set: {
          claimedBy: new Types.ObjectId(operatorId),
          lockUntil: new Date(now.getTime() + CLAIM_LOCK_MS),
          status: 'claimed',
        },
      } as never,
    );
    if (!claimed) throw err.conflict('case_claimed');
    return this.presentCase(claimed as unknown as CaseDoc);
  }

  async act(
    operatorId: string,
    operatorRole: string,
    caseId: string,
    input: { action: string; reasonCode: string; note?: string },
  ) {
    const doc = (await this.repos.moderationCases.findById(caseId)) as unknown as CaseDoc | null;
    if (!doc) throw err.notFound('case_not_found');
    if (doc.status === 'closed') throw err.conflict('case_closed');
    if (
      doc.claimedBy &&
      String(doc.claimedBy) !== operatorId &&
      doc.lockUntil &&
      doc.lockUntil.getTime() > Date.now()
    ) {
      throw err.conflict('case_claimed');
    }

    const target = await this.resolveTarget(doc);
    if (!target) throw err.notFound('target_not_found');

    if (input.action === 'ban') {
      if (doc.pendingBan?.proposedBy) {
        if (String(doc.pendingBan.proposedBy) === operatorId) {
          throw err.forbidden('second_approver_required');
        }
        if (!['seniorModerator', 'superadmin'].includes(operatorRole)) {
          throw err.forbidden('second_approver_required');
        }
        await this.applyBan(operatorId, doc, target.userId, input.reasonCode);
        return { status: 'ban_applied' as const };
      }

      await this.repos.moderationCases.updateOne(
        { _id: doc._id } as never,
        {
          $set: {
            pendingBan: {
              proposedBy: new Types.ObjectId(operatorId),
              reasonCode: input.reasonCode,
              proposedAt: new Date(),
            },
          },
        } as never,
      );
      await appendAudit(this.repos, {
        actor: 'operator',
        actorId: operatorId,
        action: 'enforcement.ban.proposed',
        entityType: 'moderationCase',
        entityId: String(doc._id),
        after: { userId: target.userId, reasonCode: input.reasonCode },
      });
      return { status: 'pending_second_approval' as const };
    }

    switch (input.action) {
      case 'dismiss':
        break;
      case 'warn':
        await this.applyEnforcement(target.userId, 'warned', input.reasonCode, operatorId, null);
        break;
      case 'suspend': {
        const until = new Date(Date.now() + SUSPENSION_DAYS * DAY);
        await this.applyEnforcement(
          target.userId,
          'suspended',
          input.reasonCode,
          operatorId,
          until,
        );
        await this.deps.payments.pauseBoosts(target.userId);
        break;
      }
      case 'delist': {
        const listingId = target.listingId ?? (await this.primaryListing(target.userId));
        if (listingId) {
          await this.repos.listings.raw.updateOne(
            { _id: new Types.ObjectId(listingId) },
            { $set: { status: 'delisted' } },
          );
        }
        break;
      }
      default:
        throw err.badRequest('unknown_action');
    }

    await this.closeCase(doc._id, operatorId, input.action, input.reasonCode);
    await appendAudit(this.repos, {
      actor: 'operator',
      actorId: operatorId,
      action: `enforcement.${input.action}`,
      entityType: 'moderationCase',
      entityId: String(doc._id),
      after: { action: input.action, reasonCode: input.reasonCode, userId: target.userId },
    });
    return { status: 'closed' as const };
  }

  private async resolveTarget(
    doc: CaseDoc,
  ): Promise<{ userId: string; listingId?: string } | null> {
    // Report-sourced cases key `refId` on the reported target (that is what
    // dedupes one case per target), so the report is looked up by `targetId`.
    const report = (await this.repos.reports.findOne({
      targetId: doc.refId,
    } as never)) as unknown as ReportDoc | null;
    if (!report) return null;

    if (report.targetType === 'user') return { userId: String(report.targetId) };
    if (report.targetType === 'listing') {
      const listing = (await this.repos.listings.findById(String(report.targetId))) as unknown as {
        sellerId: Types.ObjectId;
      } | null;
      if (!listing) return null;
      return { userId: String(listing.sellerId), listingId: String(report.targetId) };
    }
    const message = (await this.repos.messages.findById(String(report.targetId))) as unknown as {
      senderId: Types.ObjectId;
      threadId: Types.ObjectId;
    } | null;
    if (!message) return null;
    const thread = (await this.repos.threads.findById(String(message.threadId))) as unknown as {
      listingId: Types.ObjectId;
    } | null;
    return {
      userId: String(message.senderId),
      listingId: thread?.listingId ? String(thread.listingId) : undefined,
    };
  }

  private async primaryListing(userId: string): Promise<string | null> {
    const listing = (await this.repos.listings.findOne({
      sellerId: new Types.ObjectId(userId),
    } as never)) as unknown as { _id: Types.ObjectId } | null;
    return listing ? String(listing._id) : null;
  }

  private async applyEnforcement(
    userId: string,
    state: 'warned' | 'suspended' | 'banned',
    reasonCode: string,
    operatorId: string,
    until: Date | null,
  ) {
    const user = (await this.repos.users.findById(userId)) as unknown as UserDoc | null;
    if (!user) throw err.notFound('user_not_found');
    await this.repos.users.updateOne(
      { _id: user._id } as never,
      {
        $set: {
          'enforcement.state': state,
          'enforcement.until': until,
          'enforcement.reasonCode': reasonCode,
        },
        $push: {
          'enforcement.history': {
            action: state,
            reasonCode,
            by: new Types.ObjectId(operatorId),
            at: new Date(),
          },
        },
      } as never,
    );

    const event =
      state === 'warned'
        ? 'enforcement.warning'
        : state === 'suspended'
          ? 'enforcement.suspension'
          : 'enforcement.ban';
    await this.deps.notifications.emit({
      userId,
      event,
      payload: { reasonCode, until },
      dedupeKey: `${event}:${userId}:${Date.now()}`,
      critical: true,
    });
  }

  private async applyBan(
    operatorId: string,
    doc: CaseDoc,
    userId: string,
    reasonCode: string,
  ) {
    await this.applyEnforcement(userId, 'banned', reasonCode, operatorId, null);

    // Listings end, chats freeze, paid boosts are forfeited (fraud/abuse).
    await this.repos.listings.raw.updateMany(
      { sellerId: new Types.ObjectId(userId) },
      { $set: { status: 'delisted' } },
    );
    await this.repos.threads.raw.updateMany(
      { $or: [{ buyerId: new Types.ObjectId(userId) }, { sellerId: new Types.ObjectId(userId) }] },
      { $set: { state: 'frozen' } },
    );
    await this.repos.listings.raw.updateMany(
      { sellerId: new Types.ObjectId(userId) },
      {
        $set: {
          'boost.active': false,
          'boost.until': null,
          'boost.pausedAt': null,
          'boost.remainingMs': 0,
        },
      },
    );

    await this.repos.moderationCases.updateOne(
      { _id: doc._id } as never,
      {
        $push: { banApprovals: { by: new Types.ObjectId(operatorId), at: new Date() } },
      } as never,
    );
    await this.closeCase(doc._id, operatorId, 'ban', reasonCode);
    await appendAudit(this.repos, {
      actor: 'operator',
      actorId: operatorId,
      action: 'enforcement.ban',
      entityType: 'user',
      entityId: userId,
      after: { reasonCode, caseId: String(doc._id) },
    });
  }

  private async closeCase(
    caseId: Types.ObjectId,
    operatorId: string,
    action: string,
    reasonCode: string,
  ) {
    await this.repos.moderationCases.updateOne(
      { _id: caseId } as never,
      {
        $set: {
          status: 'closed',
          action,
          reasonCode,
          resolvedBy: new Types.ObjectId(operatorId),
          resolvedAt: new Date(),
          claimedBy: null,
          lockUntil: null,
        },
      } as never,
    );
  }

  // ── Appeals ────────────────────────────────────────────────────────────────

  async createAppeal(userId: string, input: AppealInput) {
    const user = (await this.repos.users.findById(userId)) as unknown as UserDoc | null;
    if (!user) throw err.notFound('user_not_found');
    const suspended = ['suspended', 'banned'].includes(user.enforcement?.state ?? 'none');
    const slaDue = new Date(Date.now() + (suspended ? 24 : 72) * HOUR);

    const duplicate = await this.repos.appeals.findOne({
      userId: new Types.ObjectId(userId),
      referenceId: new Types.ObjectId(input.referenceId),
      status: 'open',
    } as never);
    if (duplicate) throw err.conflict('appeal_open_exists');

    const appeal = (await this.repos.appeals.insert({
      userId: new Types.ObjectId(userId),
      referenceId: new Types.ObjectId(input.referenceId),
      caseId: input.type === 'enforcement' ? new Types.ObjectId(input.referenceId) : null,
      type: input.type,
      body: input.message,
      status: 'open',
      slaDue,
    } as never)) as unknown as AppealDoc;

    await appendAudit(this.repos, {
      actor: 'user',
      actorId: userId,
      action: 'appeal.create',
      entityType: 'appeal',
      entityId: String(appeal._id),
      after: { type: input.type, referenceId: input.referenceId },
    });
    return { appealId: String(appeal._id), slaDue };
  }

  async getAppeal(userId: string, appealId: string) {
    const appeal = (await this.repos.appeals.findById(appealId)) as unknown as AppealDoc | null;
    if (!appeal || String(appeal.userId) !== userId) throw err.notFound('appeal_not_found');
    return {
      id: String(appeal._id),
      type: appeal.type,
      status: appeal.status,
      outcome: appeal.outcome ?? null,
      slaDue: appeal.slaDue,
      resolution: appeal.resolutionNote ?? null,
      createdAt: (appeal as unknown as { createdAt?: Date }).createdAt,
    };
  }

  async listAppeals(status: string | undefined) {
    const filter = status ? { status } : { status: 'open' };
    const appeals = await this.repos.appeals.find(filter as never, {
      sort: { slaDue: 1 },
      limit: 50,
    });
    return appeals.map((item) => {
      const doc = item as unknown as AppealDoc;
      return {
        id: String(doc._id),
        userId: String(doc.userId),
        type: doc.type,
        status: doc.status,
        slaDue: doc.slaDue,
        slaState: doc.slaDue.getTime() < Date.now() ? 'breached' : 'ok',
      };
    });
  }

  async decideAppeal(
    operatorId: string,
    appealId: string,
    outcome: 'uphold' | 'reverse',
    reason: string,
  ) {
    const appeal = (await this.repos.appeals.findById(appealId)) as unknown as AppealDoc | null;
    if (!appeal) throw err.notFound('appeal_not_found');
    if (appeal.status !== 'open') throw err.conflict('appeal_already_decided');

    const userId = String(appeal.userId);
    if (outcome === 'reverse') {
      if (appeal.type === 'kyc' && appeal.referenceId) {
        await this.repos.kycSubmissions.updateOne(
          { _id: appeal.referenceId } as never,
          {
            $set: { status: 'pending', claimedBy: null, lockUntil: null, reviewedAt: null },
          } as never,
        );
      } else if (appeal.type === 'delisting' && appeal.referenceId) {
        await this.repos.listings.raw.updateOne(
          { _id: appeal.referenceId },
          {
            $set: {
              status: 'active',
              expiresAt: new Date(Date.now() + 30 * DAY),
            },
          },
        );
      } else {
        await this.repos.users.updateOne(
          { _id: new Types.ObjectId(userId) } as never,
          {
            $set: {
              'enforcement.state': 'none',
              'enforcement.until': null,
              'enforcement.reasonCode': null,
            },
          } as never,
        );
        await this.deps.payments.resumeBoosts(userId);
      }
    }

    await this.repos.appeals.updateOne(
      { _id: appeal._id } as never,
      {
        $set: {
          status: 'resolved',
          outcome,
          resolutionNote: reason,
          resolvedBy: new Types.ObjectId(operatorId),
          resolvedAt: new Date(),
        },
      } as never,
    );

    await this.deps.notifications.emit({
      userId,
      event: outcome === 'reverse' ? 'enforcement.lift' : 'appeal.decision',
      payload: { outcome },
      dedupeKey: `appeal.decided:${String(appeal._id)}`,
      critical: true,
    });
    await appendAudit(this.repos, {
      actor: 'operator',
      actorId: operatorId,
      action: outcome === 'reverse' ? 'enforcement.lift' : 'appeal.uphold',
      entityType: 'appeal',
      entityId: String(appeal._id),
      before: { status: 'open' },
      after: { status: 'resolved', outcome, reason },
    });

    return { status: 'resolved' as const, outcome };
  }

  // ── Support tickets ────────────────────────────────────────────────────────

  async createTicket(userId: string, input: SupportTicketInput) {
    const ticket = (await this.repos.supportTickets.insert({
      userId: new Types.ObjectId(userId),
      category: input.category,
      subject: input.subject,
      body: input.body,
      attachmentMediaId: input.attachmentMediaId
        ? new Types.ObjectId(input.attachmentMediaId)
        : null,
      status: 'open',
      messages: [
        {
          authorType: 'user',
          authorId: new Types.ObjectId(userId),
          body: input.body,
          at: new Date(),
        },
      ],
      lastReplyAt: null,
      slaDue: new Date(Date.now() + 48 * HOUR),
    } as never)) as unknown as TicketDoc;

    return { ticketId: String(ticket._id), slaDue: ticket.slaDue };
  }

  async listTickets(userId: string) {
    const tickets = await this.repos.supportTickets.listByUser(userId);
    return tickets.map((item) => {
      const doc = item as unknown as TicketDoc;
      return {
        id: String(doc._id),
        subject: doc.subject,
        status: doc.status,
        slaDue: doc.slaDue,
        createdAt: (doc as unknown as { createdAt?: Date }).createdAt,
      };
    });
  }

  private async ownedTicket(userId: string, ticketId: string): Promise<TicketDoc> {
    const ticket = (await this.repos.supportTickets.findById(ticketId)) as unknown as TicketDoc | null;
    if (!ticket || String(ticket.userId) !== userId) throw err.notFound('ticket_not_found');
    return ticket;
  }

  async listTicketMessages(userId: string, ticketId: string) {
    const ticket = await this.ownedTicket(userId, ticketId);
    return ticket.messages.map((message) => ({
      id: String(message._id),
      authorType: message.authorType,
      body: message.body,
      at: message.at,
    }));
  }

  async postTicketMessage(userId: string, ticketId: string, input: TicketMessageInput) {
    const ticket = await this.ownedTicket(userId, ticketId);
    if (ticket.status === 'closed') throw err.conflict('ticket_closed');

    const message = {
      authorType: 'user',
      authorId: new Types.ObjectId(userId),
      body: input.body,
      at: new Date(),
    };
    await this.repos.supportTickets.updateOne(
      { _id: ticket._id } as never,
      { $push: { messages: message }, $set: { status: 'open', lastReplyAt: new Date() } } as never,
    );
    return { ok: true };
  }

  async listOpsTickets(status: string | undefined) {
    const filter = status ? { status } : { status: { $in: ['open', 'pending'] } };
    const tickets = await this.repos.supportTickets.find(filter as never, {
      sort: { slaDue: 1 },
      limit: 50,
    });
    return tickets.map((item) => {
      const doc = item as unknown as TicketDoc;
      return {
        id: String(doc._id),
        userId: String(doc.userId),
        subject: doc.subject,
        status: doc.status,
        slaDue: doc.slaDue,
      };
    });
  }

  async opsReply(operatorId: string, ticketId: string, input: TicketMessageInput) {
    const ticket = (await this.repos.supportTickets.findById(ticketId)) as unknown as TicketDoc | null;
    if (!ticket) throw err.notFound('ticket_not_found');

    await this.repos.supportTickets.updateOne(
      { _id: ticket._id } as never,
      {
        $push: {
          messages: {
            authorType: 'operator',
            authorId: new Types.ObjectId(operatorId),
            body: input.body,
            at: new Date(),
          },
        },
        $set: { status: 'pending', lastReplyAt: new Date() },
      } as never,
    );

    await this.deps.notifications.emit({
      userId: String(ticket.userId),
      event: 'support.reply',
      payload: { ticketId: String(ticket._id) },
      dedupeKey: `support.reply:${String(ticket._id)}:${Date.now()}`,
    });
    await appendAudit(this.repos, {
      actor: 'operator',
      actorId: operatorId,
      action: 'support.reply',
      entityType: 'supportTicket',
      entityId: String(ticket._id),
      after: { body: input.body.slice(0, 120) },
    });
    return { ok: true };
  }
}
