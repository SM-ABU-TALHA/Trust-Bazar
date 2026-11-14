import type { ReactNode } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { ListingCard } from '@/components/listings/listing-card';
import type { Locale } from '@/lib/format';
import type { ListingCard as ListingCardData } from '@/lib/types';

export interface ListingGridProps {
  items: ListingCardData[];
  locale: Locale;
  emptyTitle: string;
  emptyBody: string;
  emptyAction?: ReactNode;
}

export function ListingGrid({ items, locale, emptyTitle, emptyBody, emptyAction }: ListingGridProps) {
  if (items.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyBody} action={emptyAction} />;
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((listing) => (
        <ListingCard key={listing.id} listing={listing} locale={locale} />
      ))}
    </div>
  );
}
