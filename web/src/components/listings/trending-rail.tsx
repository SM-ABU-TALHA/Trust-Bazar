'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ListingCard } from '@/components/listings/listing-card';
import type { Locale } from '@/lib/format';
import type { ListingCard as ListingCardData } from '@/lib/types';

/**
 * Trending rail: SSR-seeded via `initialData`, then refreshed by React Query
 * (5-minute stale window) through the `/api/trending` proxy route.
 */
export function TrendingRail({
  initialItems,
  locale,
  district,
}: {
  initialItems: ListingCardData[];
  locale: Locale;
  district?: string;
}) {
  const t = useTranslations();
  const { data, isFetching } = useQuery({
    queryKey: ['trending', district ?? 'all'],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '12' });
      if (district) params.set('district', district);
      const response = await fetch(`/api/trending?${params.toString()}`);
      if (!response.ok) throw new Error('trending_unavailable');
      const body = (await response.json()) as { data: ListingCardData[] };
      return body.data;
    },
    initialData: initialItems,
  });

  const items = data ?? [];

  return (
    <section aria-labelledby="trending-heading" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="trending-heading" className="text-xl">
            {t('home.trendingTitle')}
          </h2>
          <p className="text-sm text-ink-500">{t('home.trendingSubtitle')}</p>
        </div>
        {isFetching ? (
          <span className="text-xs text-ink-400" aria-live="polite">
            {t('common.loading')}
          </span>
        ) : null}
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ink-300 bg-surface-muted px-6 py-12 text-center">
          <h3 className="text-base text-ink-900">{t('home.noResultsTitle')}</h3>
          <p className="mt-1 text-sm text-ink-600">{t('home.noResultsBody')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((listing) => (
            <ListingCard key={listing.id} listing={listing} locale={locale} />
          ))}
        </div>
      )}
    </section>
  );
}
