import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { ListingGrid } from '@/components/listings/listing-grid';
import { TranslatedErrorState } from '@/components/states/error-state';
import { buttonClass } from '@/components/ui/button';
import { CATEGORY_BY_SLUG, CATEGORY_SEED, categoryName } from '@/lib/categories';
import { categoryObjectId } from '@/lib/category-id';
import { searchListingsPage } from '@/lib/api';
import { buildQuery, parseFilters, toApiInput, type RawSearchParams } from '@/lib/search-params';
import { buildMetadata } from '@/lib/seo';
import { formatNumber, type Locale } from '@/lib/format';
import type { ListingCard } from '@/lib/types';

const PAGE_SIZE = 24;

export function generateStaticParams() {
  return CATEGORY_SEED.map((category) => ({ slug: category.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const category = CATEGORY_BY_SLUG.get(slug);
  const t = await getTranslations({ locale });

  if (!category) {
    return { title: t('states.notFoundTitle'), robots: { index: false, follow: true } };
  }

  const name = categoryName(category, locale as Locale);
  return buildMetadata({
    locale: locale as Locale,
    path: `/category/${slug}`,
    title: name,
    description: `${categoryName(category, locale as Locale)} — ${t('category.subtitle')}`,
  });
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const category = CATEGORY_BY_SLUG.get(slug);
  if (!category) notFound();

  const t = await getTranslations({ locale });
  const activeLocale = locale as Locale;
  const name = categoryName(category, activeLocale);
  const raw = await searchParams;
  const parsed = parseFilters({ ...raw, category: slug });
  const filters = { ...parsed, categorySlug: slug, categoryId: categoryObjectId(slug) };

  const result = await searchListingsPage({ ...toApiInput(filters), limit: PAGE_SIZE });
  const items: ListingCard[] = result.ok ? result.data.items : [];
  const total = result.ok ? result.data.total : 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const children = CATEGORY_SEED.filter((item) => item.parentSlug === slug);

  const prevHref = `/category/${slug}${buildQuery(filters, {
    categorySlug: undefined,
    page: filters.page - 1,
  })}`;
  const nextHref = `/category/${slug}${buildQuery(filters, {
    categorySlug: undefined,
    page: filters.page + 1,
  })}`;

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-500">
        <ol className="flex items-center gap-2">
          <li>
            <Link href="/" className="text-ink-600 no-underline hover:text-brand-700">
              {t('category.breadcrumbHome')}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-ink-900">
            {name}
          </li>
        </ol>
      </nav>

      <header className="space-y-2">
        <h1 className="text-2xl sm:text-3xl">{name}</h1>
        <p className="text-sm text-ink-600">{t('category.subtitle')}</p>
        {result.ok ? (
          <p className="text-sm font-medium text-brand-800">
            {t('category.count', { total: formatNumber(total, activeLocale) })}
          </p>
        ) : null}
      </header>

      {children.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {children.map((child) => (
            <Link
              key={child.slug}
              href={`/search?category=${child.slug}`}
              className="rounded-full border border-line bg-surface px-3 py-1 text-sm text-ink-700 no-underline hover:border-brand-300 hover:text-brand-800"
            >
              {categoryName(child, activeLocale)}
            </Link>
          ))}
        </div>
      ) : null}

      {result.ok ? (
        <>
          <ListingGrid
            items={items}
            locale={activeLocale}
            emptyTitle={t('category.emptyTitle')}
            emptyBody={t('category.emptyBody')}
            emptyAction={
              <Link href="/search" className={buttonClass({ variant: 'secondary', size: 'sm' })}>
                {t('category.browseOther')}
              </Link>
            }
          />

          {totalPages > 1 ? (
            <nav aria-label="Pagination" className="flex items-center justify-between gap-4 pt-2">
              {filters.page > 1 ? (
                <Link href={prevHref} className={buttonClass({ variant: 'secondary', size: 'sm' })}>
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
                <Link href={nextHref} className={buttonClass({ variant: 'secondary', size: 'sm' })}>
                  {t('search.next')} →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </>
      ) : (
        <TranslatedErrorState />
      )}
    </div>
  );
}
