/**
 * Display-name moderation — PRD §3.4.6 (impersonation / profanity guard).
 * Matching is case-insensitive, punctuation-insensitive and substring-based,
 * so `TrustBazar_Support` and `trust bazar support` are both rejected.
 */
export const BANNED_DISPLAY_NAME_TERMS = [
  'trustbazar',
  'trust bazar',
  'admin',
  'administrator',
  'moderator',
  'moderation',
  'official',
  'support team',
  'customer care',
  'seller support',
  'bangladesh government',
  'fuck',
  'fucking',
  'shit',
  'bitch',
  'bastard',
  'madarchod',
  'maderchod',
  'khanki',
  'magi',
  'choda',
  'chudi',
] as const;

/** Lowercase, strip punctuation/emoji, collapse whitespace. */
export function normalizeDisplayName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when the name contains a banned term or is only digits/whitespace. */
export function isBannedDisplayName(value: string): boolean {
  const normalized = normalizeDisplayName(value);
  if (normalized.length === 0) return true;
  if (/^\d+$/.test(normalized)) return true;
  return BANNED_DISPLAY_NAME_TERMS.some((term) => normalized.includes(term));
}

/**
 * Prohibited-listing keyword pre-check (PRD §3.3.11 + Appendix C). A match
 * only *flags* the listing for the moderation queue — it never blocks the
 * seller (prompt 09: "never silent-block").
 */
export const PROHIBITED_LISTING_TERMS = [
  'gun',
  'pistol',
  'rifle',
  'ammunition',
  'explosive',
  'bomb',
  'yaba',
  'heroin',
  'cocaine',
  'ganja',
  'drug dealer',
  'tiger skin',
  'elephant tusk',
  'ivory',
  'fake passport',
  'fake nid',
  'forged document',
  'counterfeit note',
  'porn',
  'sex toy',
  'বন্দুক',
  'গুলী',
  'বিস্ফোরক',
  'বোমা',
  'ইয়াবা',
  'হেরোইন',
  'গাঁজা',
  'মাদক',
  'হাতির দাঁত',
  'বাঘের চামড়া',
  'জাল পাসপোর্ট',
  'জাল এনআইডি',
  'পর্ন',
] as const;

/** Returns every prohibited term present in `text` (word-boundary match). */
export function findProhibitedTerms(text: string): string[] {
  const normalized = normalizeDisplayName(text);
  return PROHIBITED_LISTING_TERMS.filter((term) => {
    const needle = normalizeDisplayName(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|\\s)${needle}(\\s|$)`).test(normalized);
  });
}
