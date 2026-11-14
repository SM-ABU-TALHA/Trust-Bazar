'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

export interface GalleryImage {
  id: string;
  url: string | null;
  width: number | null;
  height: number | null;
}

export function Gallery({ images, title }: { images: GalleryImage[]; title: string }) {
  const t = useTranslations();
  const [activeIndex, setActiveIndex] = useState(0);
  const usable = images.filter((image) => image.url);
  const current = usable[Math.min(activeIndex, usable.length - 1)];

  if (!current) {
    return (
      <div className="flex aspect-[4/3] items-center justify-center rounded-xl border border-line bg-ink-100 text-sm text-ink-400">
        {t('listing.noImage')}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border border-line bg-ink-100">
        <img
          src={current.url as string}
          alt={`${title} — ${activeIndex + 1}`}
          width={current.width ?? 960}
          height={current.height ?? 720}
          className="aspect-[4/3] w-full object-contain"
        />
      </div>

      {usable.length > 1 ? (
        <ul aria-label={t('listing.galleryAria')} className="flex gap-2 overflow-x-auto pb-1">
          {usable.map((image, index) => (
            <li key={image.id}>
              <button
                type="button"
                onClick={() => setActiveIndex(index)}
                aria-label={t('listing.thumbAria', { index: index + 1 })}
                aria-pressed={index === activeIndex}
                className={
                  index === activeIndex
                    ? 'block rounded-lg ring-2 ring-brand-600'
                    : 'block rounded-lg ring-1 ring-line hover:ring-brand-300'
                }
              >
                <img
                  src={image.url as string}
                  alt=""
                  width={96}
                  height={72}
                  loading="lazy"
                  className="h-16 w-20 rounded-lg object-cover"
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
