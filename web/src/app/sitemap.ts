import type { MetadataRoute } from 'next';
import { CATEGORY_SEED } from '@trust/shared/constants';
import { routing } from '@/i18n/routing';
import { searchListingsPage } from '@/lib/api';
import { absoluteUrl, localePath } from '@/lib/seo';

export const revalidate = 3600;

/** hreflang pairs for one logical page across both locales. */
function alternates(path: string) {
  return {
    languages: {
      'bn-BD': absoluteUrl(localePath('bn', path)),
      en: absoluteUrl(localePath('en', path)),
    },
  };
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const entries: MetadataRoute.Sitemap = [];

  for (const locale of routing.locales) {
    for (const path of ['/', '/legal/terms', '/legal/privacy', '/legal/prohibited']) {
      entries.push({
        url: absoluteUrl(localePath(locale, path)),
        lastModified: now,
        changeFrequency: path === '/' ? 'daily' : 'monthly',
        priority: path === '/' ? 1 : 0.5,
        alternates: alternates(path),
      });
    }

    for (const category of CATEGORY_SEED) {
      const path = `/category/${category.slug}`;
      entries.push({
        url: absoluteUrl(localePath(locale, path)),
        lastModified: now,
        changeFrequency: 'daily',
        priority: 0.8,
        alternates: alternates(path),
      });
    }
  }

  const recent = await searchListingsPage({ limit: 50, sort: 'date_desc' });
  if (recent.ok) {
    for (const locale of routing.locales) {
      for (const listing of recent.data.items) {
        const path = `/listings/${listing.id}`;
        entries.push({
          url: absoluteUrl(localePath(locale, path)),
          lastModified: listing.createdAt ? new Date(listing.createdAt) : now,
          changeFrequency: 'weekly',
          priority: 0.7,
          alternates: alternates(path),
        });
      }
    }
  }

  return entries;
}
