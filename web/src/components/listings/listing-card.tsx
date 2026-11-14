import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { districtLabel } from '@/lib/categories';
import { formatBdt } from '@/lib/format';
import type { Locale } from '@/lib/format';
import type { ListingCard as ListingCardData } from '@/lib/types';

export function ListingCard({ listing, locale }: { listing: ListingCardData; locale: Locale }) {
  const t = useTranslations();

  return (
    <article className="group overflow-hidden rounded-xl border border-line bg-surface shadow-card transition-shadow hover:shadow-raised">
      <Link href={`/listings/${listing.id}`} className="block no-underline">
        <div className="relative aspect-[4/3] bg-ink-100">
          {listing.heroMediaUrl ? (
            <img
              src={listing.heroMediaUrl}
              alt={listing.title}
              width={480}
              height={360}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-ink-400">
              {t('listing.noImage')}
            </div>
          )}
          {listing.boosted ? (
            <span className="absolute left-2 top-2">
              <Badge variant="warning">{t('common.sponsored')}</Badge>
            </span>
          ) : null}
        </div>

        <div className="space-y-1.5 p-4">
          <h3 className="line-clamp-2 text-base font-semibold text-ink-900">{listing.title}</h3>
          <p className="text-lg font-semibold text-brand-800">{formatBdt(listing.price, locale)}</p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
            <Badge variant="neutral">{t(`conditions.${listing.condition}`)}</Badge>
            {listing.district ? <span>{districtLabel(listing.district, locale)}</span> : null}
          </div>
        </div>
      </Link>
    </article>
  );
}
