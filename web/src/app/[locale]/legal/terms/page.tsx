import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LegalDocument } from '@/components/legal-document';
import { LEGAL_UPDATED, TERMS } from '@/content/legal';
import { buildMetadata } from '@/lib/seo';
import type { Locale } from '@/lib/format';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'legal' });

  return buildMetadata({
    locale: locale as Locale,
    path: '/legal/terms',
    title: t('termsTitle'),
    description: TERMS.summary[locale as Locale],
  });
}

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <LegalDocument doc={TERMS} locale={locale as Locale} updatedAt={LEGAL_UPDATED} />;
}
