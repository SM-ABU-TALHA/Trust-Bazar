import type {
  AiScanStatus,
  AppealOutcome,
  AppealType,
  Condition,
  DealChannel,
  DealType,
  EnforcementState,
  KycRejectionReason,
  KycStatus,
  KycType,
  Language,
  ListingStatus,
  MediaPurpose,
  MediaStatus,
  MessageFlag,
  NotificationChannel,
  OfferStatus,
  PaymentProvider,
  PaymentState,
  Platform,
  ReportCategory,
  ReportTarget,
  Role,
  SupportTicketStatus,
  ThreadState,
} from '../constants/index.js';

export interface UserProfile {
  displayName: string;
  photoUrl?: string;
  memberSince: string;
  sellerStats: { activeListings: number; confirmedDeals: number; disputes90d: number };
}

export interface UserSession {
  id: string;
  platform: Platform;
  issuedAt: string;
  expiresAt: string;
  lastUsedAt: string;
  current: boolean;
}

export interface User {
  id: string;
  phone: string;
  roles: Role[];
  enforcement: {
    state: EnforcementState;
    until?: string;
    reasonCode?: string;
  };
  profile: UserProfile;
  notificationPrefs: { push: boolean; sms: boolean; digest: boolean; lang: Language };
  createdAt: string;
}

export interface KycSubmission {
  id: string;
  userId: string;
  type: KycType;
  status: KycStatus;
  reasonCode?: KycRejectionReason;
  attemptsUsed: number;
  porichoyTxnId?: string;
  submittedAt: string;
  decidedAt?: string;
}

export interface ListingLocation {
  district: string;
  geo?: { type: 'Point'; coordinates: [number, number] };
}

export interface ListingMedia {
  id: string;
  url: string;
  order: number;
  status: MediaStatus;
}

export interface Listing {
  id: string;
  sellerId: string;
  title: string;
  description: string;
  price: number;
  condition: Condition;
  categoryId: string;
  location: ListingLocation;
  media: ListingMedia[];
  status: ListingStatus;
  aiScan: { status: AiScanStatus; flags?: string[] };
  boost?: { active: boolean; until?: string; packageId?: string };
  version: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface Thread {
  id: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  state: ThreadState;
  lastMessageAt?: string;
  unreadCount: number;
  createdAt: string;
}

export interface Message {
  id: string;
  threadId: string;
  senderId: string;
  clientMsgId: string;
  body: string;
  flags: MessageFlag[];
  /** Set when the counterpart opens the thread (1:1 read receipt). */
  readAt?: string | null;
  createdAt: string;
}

export interface Offer {
  id: string;
  listingId: string;
  threadId: string;
  buyerId: string;
  sellerId: string;
  amount: number;
  status: OfferStatus;
  /** Present when the seller answered with a counter amount. */
  counterAmount?: number | null;
  expiresAt: string;
  createdAt: string;
}

export interface Deal {
  id: string;
  listingId: string;
  sellerId: string;
  buyerId?: string;
  type: DealType;
  channel: DealChannel;
  finalPrice: number;
  confirmedAt?: string;
  undoUntil?: string;
  createdAt: string;
}

export interface Payment {
  id: string;
  userId: string;
  listingId?: string;
  packageId?: string;
  provider: PaymentProvider;
  state: PaymentState;
  amount: number;
  gatewayTxnId?: string;
  createdAt: string;
  completedAt?: string;
}

export interface Notification {
  id: string;
  userId: string;
  event: string;
  channel: NotificationChannel;
  title: string;
  body: string;
  data?: Record<string, string>;
  readAt?: string;
  createdAt: string;
}

export interface MediaObject {
  id: string;
  ownerId: string;
  purpose: MediaPurpose;
  url: string;
  status: MediaStatus;
  width?: number;
  height?: number;
  createdAt: string;
}

export interface ReportSummary {
  id: string;
  targetType: ReportTarget;
  targetId: string;
  category: ReportCategory;
  status: SupportTicketStatus;
  createdAt: string;
}

export interface AppealSummary {
  id: string;
  type: AppealType;
  status: 'open' | 'resolved';
  outcome?: AppealOutcome;
  createdAt: string;
}
