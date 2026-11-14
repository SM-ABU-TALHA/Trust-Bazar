'use client';

import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { cn } from '@/lib/cn';

const LABEL_KEYS: Record<string, 'bn' | 'en'> = { bn: 'bn', en: 'en' };

export function LocaleSwitcher() {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations('locale');

  const switchTo = (nextLocale: string) => {
    if (nextLocale === locale) return;

    // URL carries the active locale; the cookie makes `/` land on it next visit.
    document.cookie = `NEXT_LOCALE=${nextLocale}; path=/; max-age=31536000; samesite=lax`;
    const search = window.location.search;
    router.replace(`${pathname}${search}`, { locale: nextLocale });
  };

  return (
    <div
      className="flex items-center gap-1 rounded-full border border-ink-200 bg-surface p-0.5"
      role="group"
      aria-label={t('switchLabel')}
    >
      {routing.locales.map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => switchTo(item)}
          aria-pressed={item === locale}
          className={cn(
            'rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
            item === locale ? 'bg-brand-700 text-white' : 'text-ink-600 hover:bg-ink-100',
          )}
        >
          {t(LABEL_KEYS[item] ?? 'bn')}
        </button>
      ))}
    </div>
  );
}
