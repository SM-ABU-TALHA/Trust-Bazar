import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { LocaleSwitcher } from '@/components/layout/locale-switcher';

export function SiteFooter() {
  const t = useTranslations();
  const year = new Date().getFullYear();

  return (
    <footer className="mt-16 border-t border-line bg-surface-muted">
      <div className="container-page grid gap-8 py-10 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-2">
          <p className="text-lg font-semibold text-ink-900">{t('meta.siteName')}</p>
          <p className="text-sm text-ink-600">{t('footer.tagline')}</p>
        </div>

        <nav aria-label={t('footer.browseTitle')} className="space-y-2 text-sm">
          <p className="font-semibold text-ink-900">{t('footer.browseTitle')}</p>
          <ul className="space-y-1.5">
            <li>
              <Link href="/search" className="text-ink-600 no-underline hover:text-brand-700">
                {t('footer.search')}
              </Link>
            </li>
            <li>
              <Link href="/search" className="text-ink-600 no-underline hover:text-brand-700">
                {t('footer.categories')}
              </Link>
            </li>
            <li>
              <Link href="/login" className="text-ink-600 no-underline hover:text-brand-700">
                {t('footer.login')}
              </Link>
            </li>
          </ul>
        </nav>

        <nav aria-label={t('footer.legalTitle')} className="space-y-2 text-sm">
          <p className="font-semibold text-ink-900">{t('footer.legalTitle')}</p>
          <ul className="space-y-1.5">
            <li>
              <Link href="/legal/terms" className="text-ink-600 no-underline hover:text-brand-700">
                {t('footer.terms')}
              </Link>
            </li>
            <li>
              <Link href="/legal/privacy" className="text-ink-600 no-underline hover:text-brand-700">
                {t('footer.privacy')}
              </Link>
            </li>
            <li>
              <Link
                href="/legal/prohibited"
                className="text-ink-600 no-underline hover:text-brand-700"
              >
                {t('footer.prohibited')}
              </Link>
            </li>
          </ul>
        </nav>

        <div className="space-y-3 text-sm">
          <p className="font-semibold text-ink-900">{t('footer.language')}</p>
          <LocaleSwitcher />
          <p className="text-xs text-ink-500">{t('footer.rights', { year })}</p>
        </div>
      </div>
    </footer>
  );
}
