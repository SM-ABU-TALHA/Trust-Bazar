import { useTranslations } from 'next-intl';
import type { Locale } from '@/lib/format';
import { districtLabel } from '@/lib/categories';

export interface MapEmbedProps {
  title: string;
  district: string | null;
  geo: { type: 'Point'; coordinates: [number, number] } | null;
  locale: Locale;
}

/** Key-less OpenStreetMap embed; falls back to a district-only notice. */
export function MapEmbed({ title, district, geo, locale }: MapEmbedProps) {
  const t = useTranslations();

  if (!geo) {
    return (
      <p className="rounded-lg bg-surface-muted px-4 py-3 text-sm text-ink-600">
        {t('listing.mapDistrictOnly', {
          district: district ? districtLabel(district, locale) : t('common.na'),
        })}
      </p>
    );
  }

  const [lng, lat] = geo.coordinates;
  const delta = 0.01;
  const bbox = [lng - delta, lat - delta, lng + delta, lat + delta].join(',');
  const embedUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
  const externalUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-lg border border-line">
        <iframe
          title={`${t('listing.mapTitle')} — ${title}`}
          src={embedUrl}
          loading="lazy"
          className="h-56 w-full border-0"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>
      <a href={externalUrl} target="_blank" rel="noopener noreferrer" className="text-sm">
        {t('listing.mapOpen')}
      </a>
    </div>
  );
}
