import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { HomeSearchBar } from '@/components/layout/search-bar';
import { TrendingRail } from '@/components/listings/trending-rail';
import { BoostedRail } from '@/components/listings/boosted-rail';
import { buttonClass } from '@/components/ui/button';
import { categoryName, TOP_CATEGORIES } from '@/lib/categories';
import { getTrending } from '@/lib/api';
import { buildMetadata, serializeJsonLd, websiteJsonLd } from '@/lib/seo';
import type { Locale } from '@/lib/format';
import type { Metadata } from 'next';

export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta' });

  return buildMetadata({
    locale: locale as Locale,
    path: '/',
    title: `${t('siteName')} — ${t('tagline')}`,
    description: t('description'),
  });
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale });
  const activeLocale = locale as Locale;
  const trending = await getTrending(undefined, 12);
  const items = trending ?? [];
  const boosted = items.filter((listing) => listing.boosted);
  const organic = items.filter((listing) => !listing.boosted);

  const trustPoints = [
    { title: t('home.trust1Title'), body: t('home.trust1Body') },
    { title: t('home.trust2Title'), body: t('home.trust2Body') },
    { title: t('home.trust3Title'), body: t('home.trust3Body') },
    { title: t('home.trust4Title'), body: t('home.trust4Body') },
  ];

  return (
    <div className="space-y-14">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(websiteJsonLd(activeLocale)) }}
      />

      <section className="overflow-hidden rounded-2xl bg-brand-900 px-6 py-12 text-white sm:px-10">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-200">
          {t('home.eyebrow')}
        </p>
        <h1 className="mt-3 max-w-2xl text-3xl text-white sm:text-4xl">{t('home.title')}</h1>
        <p className="mt-3 max-w-2xl text-brand-100">{t('home.subtitle')}</p>

        <div className="mt-6 max-w-2xl">
          <HomeSearchBar locale={locale} placeholder={t('home.searchHint')} />
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Link
            href="/search"
            className={buttonClass({
              variant: 'primary',
              className: 'bg-white text-brand-900 hover:bg-brand-50',
            })}
          >
            {t('home.browseCta')}
          </Link>
          <Link
            href="/login"
            className={buttonClass({
              variant: 'ghost',
              className: 'text-white hover:bg-brand-800',
            })}
          >
            {t('home.sellCta')}
          </Link>
        </div>
      </section>

      <section aria-labelledby="categories-heading" className="space-y-4">
        <div>
          <h2 id="categories-heading" className="text-xl">
            {t('home.categoriesTitle')}
          </h2>
          <p className="text-sm text-ink-500">{t('home.categoriesSubtitle')}</p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {TOP_CATEGORIES.map((category) => (
            <Link
              key={category.slug}
              href={`/category/${category.slug}`}
              className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm font-medium text-ink-800 no-underline shadow-card hover:border-brand-300 hover:text-brand-800"
            >
              <span
                aria-hidden="true"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-sm font-semibold text-brand-700"
              >
                {categoryName(category, activeLocale).slice(0, 1)}
              </span>
              {categoryName(category, activeLocale)}
            </Link>
          ))}
        </div>
      </section>

      {boosted.length > 0 ? <BoostedRail items={boosted} locale={activeLocale} /> : null}

      <TrendingRail initialItems={organic} locale={activeLocale} />

      <section aria-labelledby="trust-heading" className="space-y-4">
        <h2 id="trust-heading" className="text-xl">
          {t('home.trustTitle')}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {trustPoints.map((point) => (
            <div key={point.title} className="rounded-xl border border-line bg-surface p-5">
              <h3 className="text-base text-ink-900">{point.title}</h3>
              <p className="mt-1 text-sm text-ink-600">{point.body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
