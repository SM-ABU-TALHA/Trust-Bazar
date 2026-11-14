import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { ListingGrid } from '@/components/listings/listing-grid';
import { SearchFilters } from '@/components/listings/search-filters';
import { TranslatedErrorState } from '@/components/states/error-state';
import { buttonClass } from '@/components/ui/button';
import { searchListingsPage } from '@/lib/api';
import { buildQuery, parseFilters, toApiInput, type RawSearchParams } from '@/lib/search-params';
import { buildMetadata } from '@/lib/seo';
import { formatNumber, type Locale } from '@/lib/format';
import type { ListingCard } from '@/lib/types';

const PAGE_SIZE = 20;

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<RawSearchParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  const { q } = await searchParams;
  const t = await getTranslations({ locale });
  const query = Array.isArray(q) ? q[0] : q;

  return buildMetadata({
    locale: locale as Locale,
    path: '/search',
    title: query ? `${query} — ${t('search.heading')}` : t('search.heading'),
    description: t('search.subheading'),
    noindex: true,
  });
}

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale });
  const activeLocale = locale as Locale;
  const raw = await searchParams;
  const filters = parseFilters(raw);

  const result = await searchListingsPage({ ...toApiInput(filters), limit: PAGE_SIZE });
  const items: ListingCard[] = result.ok ? result.data.items : [];
  const total = result.ok ? result.data.total : 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl sm:text-3xl">{t('search.heading')}</h1>
        <p className="text-sm text-ink-600">{t('search.subheading')}</p>
      </header>

      <SearchFilters filters={filters} locale={activeLocale} />

      {result.ok ? (
        <div className="space-y-6">
          {result.data.degraded ? (
            <p role="status" className="rounded-lg bg-accent-50 px-4 py-2 text-sm text-accent-700">
              {t('search.degraded')}
            </p>
          ) : null}

          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg">
              {filters.q ? t('search.resultsFor', { query: filters.q }) : t('search.heading')}
            </h2>
            <p className="text-sm text-ink-600">
              {t('search.resultsCount', { total: formatNumber(total, activeLocale) })}
            </p>
          </div>

          <ListingGrid
            items={items}
            locale={activeLocale}
            emptyTitle={t('search.emptyTitle')}
            emptyBody={t('search.emptyBody')}
            emptyAction={
              <Link href="/search" className={buttonClass({ variant: 'secondary', size: 'sm' })}>
                {t('search.emptyReset')}
              </Link>
            }
          />

          {totalPages > 1 ? (
            <nav aria-label="Pagination" className="flex items-center justify-between gap-4">
              {filters.page > 1 ? (
                <Link
                  href={`/search${buildQuery(filters, { page: filters.page - 1 })}`}
                  className={buttonClass({ variant: 'secondary', size: 'sm' })}
                >
                  ← {t('search.prev')}
                </Link>
              ) : (
                <span />
              )}
              <span className="text-sm text-ink-600">
                {t('search.pageOf', {
                  page: formatNumber(filters.page, activeLocale),
                  total: formatNumber(totalPages, activeLocale),
                })}
              </span>
              {filters.page < totalPages ? (
                <Link
                  href={`/search${buildQuery(filters, { page: filters.page + 1 })}`}
                  className={buttonClass({ variant: 'secondary', size: 'sm' })}
                >
                  {t('search.next')} →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </div>
      ) : (
        <TranslatedErrorState />
      )}
    </div>
  );
}
