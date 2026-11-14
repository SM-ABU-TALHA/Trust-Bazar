import { describe, expect, it } from 'vitest';
import { CATEGORY_SEED } from '../categories.js';
import { DISTRICT_NAMES, DISTRICTS } from '../geography.js';
import { JOB_NAMES, NOTIFICATION_EVENTS } from '../operations.js';

describe('DISTRICTS', () => {
  it('contains exactly 64 unique district names', () => {
    expect(DISTRICTS).toHaveLength(64);
    expect(DISTRICT_NAMES.size).toBe(64);
  });
});

describe('CATEGORY_SEED', () => {
  it('has unique slugs', () => {
    const slugs = CATEGORY_SEED.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('every parentSlug references an existing root category', () => {
    const slugs = new Set(CATEGORY_SEED.map((c) => c.slug));
    const roots = new Set(CATEGORY_SEED.filter((c) => !c.parentSlug).map((c) => c.slug));
    for (const c of CATEGORY_SEED) {
      if (c.parentSlug) {
        expect(slugs.has(c.parentSlug), `${c.slug} → missing parent ${c.parentSlug}`).toBe(true);
        expect(roots.has(c.parentSlug), `${c.slug} parent must be a root`).toBe(true);
      }
    }
  });
});

describe('operations constants', () => {
  it('job names are unique', () => {
    expect(new Set(JOB_NAMES).size).toBe(JOB_NAMES.length);
  });

  it('notification events are unique', () => {
    expect(new Set(NOTIFICATION_EVENTS).size).toBe(NOTIFICATION_EVENTS.length);
  });
});
