import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { buttonClass } from '@/components/ui/button';

/** Guests never see the seller's phone number (PRD §2.1). */
export function ContactCta() {
  const t = useTranslations();

  return (
    <div className="space-y-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-4">
      <div>
        <h2 className="text-base text-brand-900">{t('listing.contactTitle')}</h2>
        <p className="mt-1 text-sm text-brand-900/80">{t('listing.contactBody')}</p>
      </div>
      <Link href="/login" className={buttonClass({ fullWidth: true })}>
        {t('listing.contactCta')}
      </Link>
      <p className="text-xs text-ink-600">{t('listing.contactNote')}</p>
    </div>
  );
}
