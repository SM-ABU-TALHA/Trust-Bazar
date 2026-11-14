import { Link } from '@/i18n/navigation';
import { SearchBar } from '@/components/layout/search-bar';
import { LocaleSwitcher } from '@/components/layout/locale-switcher';
import { categoryName, TOP_CATEGORIES } from '@/lib/categories';
import { useTranslations } from 'next-intl';
import type { Locale } from '@/lib/format';

export function SiteHeader({ locale }: { locale: Locale }) {
  const t = useTranslations();

  return (
    <header className="border-b border-line bg-surface">
      <div className="container-page flex h-16 items-center gap-4">
        <Link href="/" className="flex items-center gap-2 no-underline">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-700 text-base font-bold text-white"
          >
            TB
          </span>
          <span className="hidden text-lg font-semibold text-ink-900 sm:block">
            {t('meta.siteName')}
          </span>
        </Link>

        <nav aria-label={t('nav.mainAria')} className="hidden items-center gap-5 text-sm md:flex">
          <Link href="/" className="text-ink-700 no-underline hover:text-brand-700">
            {t('nav.home')}
          </Link>
          <Link href="/search" className="text-ink-700 no-underline hover:text-brand-700">
            {t('nav.browse')}
          </Link>
        </nav>

        <div className="ml-auto hidden w-72 md:block">
          <SearchBar locale={locale} />
        </div>

        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <LocaleSwitcher />
          <Link href="/login" className="text-sm font-medium text-brand-700 no-underline">
            {t('nav.login')}
          </Link>
        </div>
      </div>

      <div className="border-t border-line bg-surface-muted">
        <nav
          aria-label={t('nav.categoriesAria')}
          className="container-page flex gap-4 overflow-x-auto py-2 text-sm"
        >
          {TOP_CATEGORIES.map((category) => (
            <Link
              key={category.slug}
              href={`/category/${category.slug}`}
              className="whitespace-nowrap text-ink-600 no-underline hover:text-brand-700"
            >
              {categoryName(category, locale)}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
