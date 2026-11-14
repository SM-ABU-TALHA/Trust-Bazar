import type { Metadata } from 'next';
import type { Locale } from './format';
import type { ListingDetail } from './types';

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(
  /\/$/,
  '',
);

const OG_LOCALES: Record<Locale, string> = { bn: 'bn_BD', en: 'en_US' };

export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Locale-prefixed path used for canonical + hreflang links. */
export function localePath(locale: Locale, path: string): string {
  const clean = path === '/' ? '' : path;
  return `/${locale}${clean}`;
}

interface MetadataInput {
  locale: Locale;
  path: string;
  title: string;
  description: string;
  image?: string | null;
  noindex?: boolean;
}

export function buildMetadata({
  locale,
  path,
  title,
  description,
  image,
  noindex = false,
}: MetadataInput): Metadata {
  const canonical = absoluteUrl(localePath(locale, path));
  const languages = {
    'bn-BD': absoluteUrl(localePath('bn', path)),
    en: absoluteUrl(localePath('en', path)),
    'x-default': absoluteUrl(localePath('bn', path)),
  };

  return {
    title,
    description,
    alternates: { canonical, languages },
    openGraph: {
      type: 'website',
      siteName: 'Trust Bazar',
      locale: OG_LOCALES[locale],
      alternateLocale: [OG_LOCALES[locale === 'bn' ? 'en' : 'bn']],
      url: canonical,
      title,
      description,
      images: image ? [{ url: image, alt: title }] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: image ? [image] : undefined,
    },
    robots: noindex ? { index: false, follow: true } : undefined,
  };
}

const CONDITION_SCHEMA: Record<string, string> = {
  new: 'https://schema.org/NewCondition',
  likeNew: 'https://schema.org/UsedCondition',
  good: 'https://schema.org/UsedCondition',
  refurbished: 'https://schema.org/RefurbishedCondition',
  forParts: 'https://schema.org/DamagedCondition',
};

export function listingJsonLd(listing: ListingDetail, locale: Locale) {
  const url = absoluteUrl(localePath(locale, `/listings/${listing.id}`));
  const images = listing.media
    .map((item) => item.url)
    .filter((value): value is string => Boolean(value));

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: listing.title,
    description: listing.description,
    ...(images.length > 0 ? { image: images } : {}),
    offers: {
      '@type': 'Offer',
      url,
      priceCurrency: 'BDT',
      price: listing.price,
      availability: 'https://schema.org/InStock',
      itemCondition: CONDITION_SCHEMA[listing.condition] ?? 'https://schema.org/UsedCondition',
      seller: {
        '@type': 'Organization',
        name: listing.seller.displayName ?? 'Trust Bazar verified seller',
      },
    },
  };
}

export function breadcrumbJsonLd(items: { name: string; url: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export function websiteJsonLd(locale: Locale) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Trust Bazar',
    url: absoluteUrl(localePath(locale, '/')),
    inLanguage: locale === 'bn' ? 'bn-BD' : 'en',
    potentialAction: {
      '@type': 'SearchAction',
      target: `${absoluteUrl(localePath(locale, '/search'))}?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  };
}

/** Escapes `<` so user content cannot break out of the JSON-LD script tag. */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
