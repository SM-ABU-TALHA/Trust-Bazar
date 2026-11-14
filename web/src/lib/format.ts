export type Locale = 'bn' | 'en';

const numberLocales: Record<Locale, string> = { bn: 'bn-BD', en: 'en-US' };
const dateLocales: Record<Locale, string> = { bn: 'bn-BD', en: 'en-GB' };

/** ৳ formatting — Bengali digits for `bn`, Latin digits for `en`. */
export function formatBdt(value: number, locale: Locale): string {
  return `৳ ${new Intl.NumberFormat(numberLocales[locale], {
    maximumFractionDigits: 0,
  }).format(value)}`;
}

export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(numberLocales[locale]).format(value);
}

/** Deterministic on server and client (fixed time zone, month + year only). */
export function formatMonthYear(iso: string | null, locale: Locale): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(dateLocales[locale], {
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Dhaka',
  }).format(date);
}

export function formatDate(iso: string | null, locale: Locale): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(dateLocales[locale], {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Dhaka',
  }).format(date);
}
