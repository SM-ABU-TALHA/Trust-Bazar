import { defineRouting } from 'next-intl/routing';

/** Bangla is the default storefront language; English is the secondary locale. */
export const routing = defineRouting({
  locales: ['bn', 'en'],
  defaultLocale: 'bn',
  localePrefix: 'always',
  localeCookie: { maxAge: 60 * 60 * 24 * 365 },
});

export type Locale = (typeof routing.locales)[number];
