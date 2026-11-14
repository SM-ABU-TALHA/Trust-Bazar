import { useTranslations } from 'next-intl';
import type { LegalDoc, ProhibitedDoc } from '@/content/legal';
import { formatDate, type Locale } from '@/lib/format';

export function LegalDocument({
  doc,
  locale,
  updatedAt,
}: {
  doc: LegalDoc | ProhibitedDoc;
  locale: Locale;
  updatedAt: string;
}) {
  const t = useTranslations('legal');
  const updated = formatDate(updatedAt, locale);
  const prohibited = 'items' in doc ? doc : null;

  return (
    <article className="prose-legal mx-auto max-w-3xl">
      <header className="space-y-2 border-b border-line pb-5">
        <h1 className="text-2xl sm:text-3xl">{doc.title[locale]}</h1>
        {updated ? (
          <p className="text-sm text-ink-500">{t('lastUpdated', { date: updated })}</p>
        ) : null}
        <p>{doc.summary[locale]}</p>
      </header>

      {doc.sections.map((section) => (
        <section key={section.heading.en} className="space-y-3">
          <h2>{section.heading[locale]}</h2>
          {section.paragraphs?.[locale]?.map((paragraph) => (
            <p key={paragraph.slice(0, 32)}>{paragraph}</p>
          ))}
          {section.bullets?.[locale]?.length ? (
            <ul>
              {section.bullets[locale].map((item) => (
                <li key={item.slice(0, 32)}>{item}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}

      {prohibited ? (
        <section className="space-y-3">
          <h2>{prohibited.title[locale]}</h2>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">{prohibited.title[locale]}</caption>
              <thead>
                <tr className="border-b border-line text-left">
                  <th scope="col" className="py-2 pr-4 font-semibold text-ink-900">
                    #
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold text-ink-900">
                    {locale === 'bn' ? 'পণ্য' : 'Item'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {prohibited.items.map((item, index) => (
                  <tr key={item.name.en} className="border-b border-line align-top">
                    <td className="py-2 pr-4 text-ink-500">{index + 1}</td>
                    <td className="py-2 pr-4">
                      <p className="font-medium text-ink-900">{item.name[locale]}</p>
                      <p className="text-xs text-ink-600">{item.examples[locale]}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <p className="text-xs text-ink-500">{t('contactNote')}</p>
    </article>
  );
}
