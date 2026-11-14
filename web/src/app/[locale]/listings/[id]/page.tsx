import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Gallery } from '@/components/listings/gallery';
import { SellerCard } from '@/components/listings/seller-card';
import { ContactCta } from '@/components/listings/contact-cta';
import { MapEmbed } from '@/components/listings/map-embed';
import { TranslatedErrorState } from '@/components/states/error-state';
import { getListing, getPriceBaseline } from '@/lib/api';
import { districtLabel } from '@/lib/categories';
import { formatBdt, formatDate, type Locale } from '@/lib/format';
import {
  absoluteUrl,
  breadcrumbJsonLd,
  buildMetadata,
  listingJsonLd,
  localePath,
  serializeJsonLd,
} from '@/lib/seo';

export const revalidate = 300;

function plainDescription(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 160);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale, id } = await params;
  const result = await getListing(id);
  const t = await getTranslations({ locale });

  if (!result.ok) {
    return {
      title: t('listing.unavailableTitle'),
      description: t('listing.unavailableBody'),
      robots: { index: false, follow: true },
    };
  }

  const listing = result.data;
  return buildMetadata({
    locale: locale as Locale,
    path: `/listings/${id}`,
    title: listing.title,
    description: plainDescription(listing.description),
    image: listing.media[0]?.url ?? null,
    noindex: listing.status !== 'active',
  });
}

export default async function ListingPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale });
  const activeLocale = locale as Locale;
  const result = await getListing(id);

  if (!result.ok) {
    if (result.kind === 'notfound') notFound();
    return <TranslatedErrorState />;
  }

  const listing = result.data;
  const baseline = await getPriceBaseline(listing.categoryId, listing.condition);
  const posted = formatDate(listing.createdAt, activeLocale);
  const conditionLabel = t(`conditions.${listing.condition}`);
  const district = listing.district ? districtLabel(listing.district, activeLocale) : null;

  const crumbs = [
    { name: t('listing.breadcrumbHome'), url: absoluteUrl(localePath(activeLocale, '/')) },
    {
      name: t('listing.breadcrumbSearch'),
      url: absoluteUrl(localePath(activeLocale, '/search')),
    },
    { name: listing.title, url: absoluteUrl(localePath(activeLocale, `/listings/${listing.id}`)) },
  ];

  return (
    <div className="space-y-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(listingJsonLd(listing, activeLocale)) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd(crumbs)) }}
      />

      <nav aria-label="Breadcrumb" className="text-sm text-ink-500">
        <ol className="flex flex-wrap items-center gap-2">
          <li>
            <Link href="/" className="text-ink-600 no-underline hover:text-brand-700">
              {t('listing.breadcrumbHome')}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link href="/search" className="text-ink-600 no-underline hover:text-brand-700">
              {t('listing.breadcrumbSearch')}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="line-clamp-1 text-ink-900">
            {listing.title}
          </li>
        </ol>
      </nav>

      {listing.status !== 'active' ? (
        <div role="status" className="rounded-lg bg-accent-50 px-4 py-3 text-sm text-accent-700">
          <p className="font-semibold">{t('listing.unavailableTitle')}</p>
          <p>{t('listing.unavailableBody')}</p>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Gallery images={listing.media} title={listing.title} />

          <div className="space-y-3">
            {listing.boost.active ? (
              <Badge variant="warning">{t('listing.boosted')}</Badge>
            ) : null}
            <h1 className="text-2xl sm:text-3xl">{listing.title}</h1>
            <p className="text-3xl font-semibold text-brand-800">
              {formatBdt(listing.price, activeLocale)}
            </p>
            {baseline && baseline.sampleSize >= 5 && baseline.p25 && baseline.p75 ? (
              <p className="text-xs text-ink-500">
                {t('listing.priceBaseline', {
                  low: formatBdt(baseline.p25, activeLocale),
                  high: formatBdt(baseline.p75, activeLocale),
                })}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-3 text-sm text-ink-600">
              <Badge variant="brand">{conditionLabel}</Badge>
              {district ? <span>{district}</span> : null}
              {posted ? <span>{t('listing.postedOn', { date: posted })}</span> : null}
              <span>{t('common.viewCount', { count: listing.stats.views })}</span>
            </div>
          </div>

          <section aria-labelledby="description-heading" className="space-y-2">
            <h2 id="description-heading" className="text-lg">
              {t('listing.description')}
            </h2>
            <p className="whitespace-pre-line text-base text-ink-700">{listing.description}</p>
          </section>

          <section
            aria-labelledby="safety-heading"
            className="space-y-2 rounded-xl bg-surface-muted p-4"
          >
            <h2 id="safety-heading" className="text-base">
              {t('listing.safetyTitle')}
            </h2>
            <ul className="list-disc space-y-1 pl-5 text-sm text-ink-600">
              <li>{t('listing.safety1')}</li>
              <li>{t('listing.safety2')}</li>
              <li>{t('listing.safety3')}</li>
            </ul>
          </section>
        </div>

        <aside className="space-y-4">
          <Card className="space-y-4 p-4">
            <h2 className="text-base">{t('listing.seller')}</h2>
            <SellerCard seller={listing.seller} locale={activeLocale} />
            <Link
              href="/search"
              className="block text-sm text-brand-700 no-underline hover:underline"
            >
              {t('listing.browseMore')}
            </Link>
          </Card>

          <ContactCta />

          <Card className="space-y-3 p-4">
            <h2 className="text-base">{t('listing.mapTitle')}</h2>
            <MapEmbed
              title={listing.title}
              district={listing.district}
              geo={listing.geo}
              locale={activeLocale}
            />
          </Card>
        </aside>
      </div>
    </div>
  );
}
