import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { buttonClass } from '@/components/ui/button';

export default async function LocaleNotFound() {
  const t = await getTranslations('states');

  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <p className="text-sm font-semibold text-brand-700">404</p>
      <h1 className="mt-2 text-2xl">{t('notFoundTitle')}</h1>
      <p className="mt-2 text-sm text-ink-600">{t('notFoundBody')}</p>
      <div className="mt-6">
        <Link href="/" className={buttonClass()}>
          {t('notFoundCta')}
        </Link>
      </div>
    </div>
  );
}
