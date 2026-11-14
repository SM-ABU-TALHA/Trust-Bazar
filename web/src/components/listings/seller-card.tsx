import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { formatMonthYear, type Locale } from '@/lib/format';
import type { ListingDetail } from '@/lib/types';

export function SellerCard({ seller, locale }: { seller: ListingDetail['seller']; locale: Locale }) {
  const t = useTranslations();
  const memberSince = formatMonthYear(seller.memberSince, locale);
  const name = seller.displayName ?? '—';

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div
          aria-hidden="true"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-100 text-base font-semibold text-brand-800"
        >
          {name.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="truncate font-semibold text-ink-900">{name}</p>
          {memberSince ? (
            <p className="text-xs text-ink-500">
              {t('listing.memberSince', { date: memberSince })}
            </p>
          ) : null}
        </div>
      </div>

      <Badge variant={seller.verified ? 'success' : 'warning'} dot>
        {seller.verified ? t('listing.verifiedSeller') : t('listing.unverifiedSeller')}
      </Badge>

      {seller.displayName ? (
        <Link
          href={`/search?q=${encodeURIComponent(seller.displayName)}`}
          className="block text-sm text-brand-700 no-underline hover:underline"
        >
          {t('listing.otherListings')}
        </Link>
      ) : null}
    </div>
  );
}
