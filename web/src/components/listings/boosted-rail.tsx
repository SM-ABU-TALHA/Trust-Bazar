import { useTranslations } from 'next-intl';
import { ListingCard } from '@/components/listings/listing-card';
import type { Locale } from '@/lib/format';
import type { ListingCard as ListingCardData } from '@/lib/types';

/** Sponsored placements always render above organic results (API §3.9 note). */
export function BoostedRail({
  items,
  locale,
  title,
}: {
  items: ListingCardData[];
  locale: Locale;
  title?: string;
}) {
  const t = useTranslations();

  if (items.length === 0) return null;

  return (
    <section aria-labelledby="boosted-heading" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="boosted-heading" className="text-xl">
          {title ?? t('home.boostedTitle')}
        </h2>
        <span className="text-xs font-medium uppercase tracking-wide text-ink-400">
          {t('home.boostedLabel')}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((listing) => (
          <ListingCard key={listing.id} listing={listing} locale={locale} />
        ))}
      </div>
    </section>
  );
}
