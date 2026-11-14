# Tasks — PROMPT 17: Web Foundation & Public Pages

**Prereq:** `spec.md` approved.
**Status legend:** ☐ todo · ◐ doing · ☑ done & verified

## A. Scaffold & tooling

- ☑ A1 `web/package.json` (next 16.4.6, react 19, next-intl, react-query, tailwind 4, `@trust/shared`) + scripts `dev/build/start/lint/typecheck`.
- ☑ A2 `tsconfig.json` (extends `@trust/config/tsconfig.react.json`, `@/*` paths), `next.config.ts` (`transpilePackages`), `postcss.config.mjs`, `eslint.config.mjs`, `next-env.d.ts`.
- ☑ A3 `pnpm install` → lockfile updated; root `pnpm typecheck`/`lint` still clean.

## B. i18n & design system

- ☑ B1 `src/i18n/{routing,request,navigation}.ts` + `src/proxy.ts` (bn default, `/` → `/bn`).
- ☑ B2 `messages/bn.json` + `messages/en.json` — every visible string (nav, home, search, listing, seller, states, legal headings, footer, meta).
- ☑ B3 `app/globals.css` `@theme` tokens (colours, type scale, spacing, radius, shadows) + base styles/a11y focus.
- ☑ B4 UI kit: `Button/Input/Modal/Toast/Badge/Card/Skeleton/EmptyState` + `lib/cn.ts`, `lib/format.ts` (৳ + bn digits), `lib/types.ts`.

## C. Shell & states

- ☑ C1 `[locale]/layout.tsx`: html lang/dir, skip link, header (logo, category nav, search, locale switcher, login link), footer (legal links), `Providers`.
- ☑ C2 `Providers` (react-query + toast), `OfflineBanner` (online/offline events), `loading.tsx` skeleton, `error.tsx` retry, `not-found.tsx`, `ErrorState`.

## D. Data & SEO plumbing

- ☑ D1 `lib/api.ts` `safeFetch` wrappers: trending, search, listing detail, price baseline; soft-fail taxonomy.
- ☑ D2 `lib/categories.ts` deterministic slug→ObjectId mirror of `seed.ts`; top categories.
- ☑ D3 `lib/seo.ts` metadata builder + `Product`/`BreadcrumbList` JSON-LD; `app/robots.ts`; `app/sitemap.ts`.

## E. Public pages

- ☑ E1 `/[locale]` home: hero + search, top categories, `BoostedRail`, organic grid, trust section.
- ☑ E2 `/[locale]/category/[slug]`: static params, header/breadcrumb, results, pagination, empty, 404.
- ☑ E3 `/[locale]/search`: GET filters (q/category/district/condition/price/sort), SSR results, total, pagination, empty, degraded notice.
- ☑ E4 `/[locale]/listings/[id]`: gallery, price, condition, description, seller card, map, Contact CTA, boosted notice, ISR + metadata + JSON-LD.
- ☑ E5 `/[locale]/login`: phone shell + consent links + release notice, noindex.
- ☑ E6 Legal pages (terms/privacy/prohibited) from `content/legal.ts`, bn/en, sourced from Pre-Launch_Actions.

## F. Verification

- ☑ F1 `pnpm -C web typecheck` + `pnpm -C web lint` clean.
- ☑ F2 `pnpm -C web build` succeeds **with backend down** (soft-fail paths).
- ☑ F3 Backend up + temp demo listing (`.trae/tmp`, deleted after): SSR view-source contains title + `৳`; `/en` vs `/bn` copy differs; locale cookie persists; category/search/sitemap/robots 200.
- ☑ F4 Lighthouse SEO ≥ 90 on `/bn/listings/<id>` (mobile).
- ☑ F5 Root regression: `pnpm typecheck`, `pnpm lint`, backend tests 141/141.

## G. Docs

- ☑ G1 `prompt.md` PROMPT 17 checkboxes ☑ + row 17 ☑.
- ☑ G2 `checklist.md` PROMPT 17 entry; `.env.example` web vars; API_spec unchanged (state explicitly in checklist).
