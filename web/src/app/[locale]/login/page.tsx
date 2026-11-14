import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { LoginForm } from '@/components/login-form';
import { Card } from '@/components/ui/card';
import { buildMetadata } from '@/lib/seo';
import type { Locale } from '@/lib/format';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'login' });

  return buildMetadata({
    locale: locale as Locale,
    path: '/login',
    title: t('title'),
    description: t('subtitle'),
    noindex: true,
  });
}

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale });

  return (
    <div className="mx-auto grid max-w-4xl gap-8 py-6 md:grid-cols-2">
      <section className="space-y-4">
        <h1 className="text-2xl sm:text-3xl">{t('login.title')}</h1>
        <p className="text-sm text-ink-600">{t('login.subtitle')}</p>

        <div className="space-y-2 rounded-xl bg-surface-muted p-4">
          <h2 className="text-base">{t('login.whyTitle')}</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-600">
            <li>{t('login.why1')}</li>
            <li>{t('login.why2')}</li>
            <li>{t('login.why3')}</li>
          </ul>
        </div>

        <Link href="/" className="inline-block text-sm text-brand-700">
          {t('login.backHome')}
        </Link>
      </section>

      <Card className="p-6">
        <LoginForm />
      </Card>
    </div>
  );
}
