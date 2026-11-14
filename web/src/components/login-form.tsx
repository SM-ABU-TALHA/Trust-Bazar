'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';

const PHONE_PATTERN = /^(?:\+8801[3-9]\d{8}|01[3-9]\d{8})$/;

/**
 * Presentation-only login shell for PROMPT 17. OTP request/verify is wired in
 * PROMPT 18 — this form validates the number and states the release notice.
 */
export function LoginForm() {
  const t = useTranslations('login');
  const toast = useToast();
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = phone.replace(/[\s-]/g, '');

    if (!PHONE_PATTERN.test(normalized)) {
      setError(t('phoneError'));
      return;
    }

    setError(null);
    toast.push({ title: t('title'), description: t('notice'), variant: 'info' });
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Input
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        label={t('phoneLabel')}
        placeholder={t('phonePlaceholder')}
        hint={t('phoneHint')}
        error={error ?? undefined}
        value={phone}
        onChange={(event) => setPhone(event.target.value)}
      />
      <Button type="submit" fullWidth>
        {t('continue')}
      </Button>
      <p className="rounded-lg bg-surface-muted px-3 py-2 text-xs text-ink-600">{t('notice')}</p>
      <p className="text-xs text-ink-500">
        {t('consentPrefix')}{' '}
        <Link href="/legal/terms" className="text-brand-700">
          {t('terms')}
        </Link>{' '}
        {t('consentJoin')}{' '}
        <Link href="/legal/privacy" className="text-brand-700">
          {t('privacy')}
        </Link>
        .
      </p>
    </form>
  );
}
