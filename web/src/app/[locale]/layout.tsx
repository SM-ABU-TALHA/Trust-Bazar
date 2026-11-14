import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { routing } from '@/i18n/routing';
import { Providers } from '@/components/providers';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { OfflineBanner } from '@/components/states/offline-banner';
import { SITE_URL } from '@/lib/seo';
import type { Locale } from '@/lib/format';
import '../globals.css';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta' });

  return {
    metadataBase: new URL(SITE_URL),
    title: {
      default: `${t('siteName')} — ${t('tagline')}`,
      template: `%s · ${t('siteName')}`,
    },
    description: t('description'),
    applicationName: t('siteName'),
    icons: { icon: '/icon.svg' },
    openGraph: {
      type: 'website',
      siteName: t('siteName'),
      title: `${t('siteName')} — ${t('tagline')}`,
      description: t('description'),
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  setRequestLocale(locale);
  const t = await getTranslations({ locale });
  const messages = await getMessages({ locale });

  return (
    <html lang={locale === 'bn' ? 'bn-BD' : 'en'}>
      <body>
        <Providers>
          <NextIntlClientProvider messages={messages}>
            <a href="#main" className="skip-link">
              {t('nav.skipToContent')}
            </a>
            <OfflineBanner title={t('states.offlineTitle')} body={t('states.offlineBody')} />
            <SiteHeader locale={locale as Locale} />
            <main id="main" className="container-page py-8">
              {children}
            </main>
            <SiteFooter />
          </NextIntlClientProvider>
        </Providers>
      </body>
    </html>
  );
}
