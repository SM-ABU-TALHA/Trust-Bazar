import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Config } from '../../config/index.js';

export type PaymentProvider = 'bkash' | 'nagad';

export interface SettlementRow {
  trxId: string;
  reference: string;
  amount: number;
  state: 'success' | 'failed';
  userId?: string;
}

export interface PaymentGateway {
  provider: PaymentProvider;
  checkoutUrl(paymentId: string, amount: number): string;
  verifySignature(raw: Buffer, signature: string | undefined): boolean;
  allowIp(ip: string | undefined): boolean;
  /** Live settlement pull; `[]` while sandbox credentials are absent. */
  fetchSettlement(): Promise<SettlementRow[]>;
}

const FALLBACK_BASE: Record<PaymentProvider, string> = {
  bkash: 'https://sandbox.bkash.com/checkout',
  nagad: 'https://sandbox.mynagad.com/checkout',
};

function splitCsv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function createGateway(config: Config, provider: PaymentProvider): PaymentGateway {
  const secret =
    provider === 'bkash' ? config.BKASH_WEBHOOK_SECRET : config.NAGAD_WEBHOOK_SECRET;
  const allowlist = splitCsv(
    provider === 'bkash' ? config.BKASH_WEBHOOK_IPS : config.NAGAD_WEBHOOK_IPS,
  );
  const baseUrl =
    (provider === 'bkash' ? config.BKASH_BASE_URL : config.NAGAD_BASE_URL) ??
    FALLBACK_BASE[provider];

  return {
    provider,
    checkoutUrl(paymentId, amount) {
      const url = new URL(baseUrl);
      url.searchParams.set('paymentId', paymentId);
      url.searchParams.set('amount', String(amount));
      url.searchParams.set('currency', 'BDT');
      return url.toString();
    },
    verifySignature(raw, signature) {
      // No secret configured means the vendor is not wired yet — reject, never trust.
      if (!secret || !signature) return false;
      const expected = createHmac('sha256', secret).update(raw).digest('hex');
      const left = Buffer.from(expected);
      const right = Buffer.from(signature.trim().toLowerCase());
      return left.length === right.length && timingSafeEqual(left, right);
    },
    allowIp(ip) {
      if (allowlist.length === 0) return true;
      return Boolean(ip && allowlist.includes(ip));
    },
    async fetchSettlement() {
      // Sandbox credentials pending (PROMPT 02 external action): degraded mode.
      return [];
    },
  };
}
