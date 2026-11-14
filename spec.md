# Spec — PROMPT 17: Web Foundation & Public Pages

**Status:** awaiting approval
**Scope:** new `web/` app — Next.js App Router + TS + Tailwind + next-intl (bn default, en toggle) + react-query; design tokens + UI kit; SSR/ISR public routes; listing detail; SEO; page states; legal pages.
**Non-goals:** authenticated web flows (PROMPT 18), ops console UI (19), mobile (20), any backend endpoint/model change (PROMPT 01–16 are frozen).

**Source refs:** `prompt.md` §PROMPT 17 · `PRD.md` NFR-07/NFR-10/NFR-11 · `Architecture.md` §3 · `API_spec.md` §3.8–3.12, §13.1 · `Pre-Launch_Actions.md` §A.2–A.3.

---

## 0. Decisions (decision-complete)

| Topic | Decision |
|---|---|
| Versions | Next `16.4.6`, React `19`, TS `5.7.2`, Tailwind `4.3.5` (+`@tailwindcss/postcss`), `next-intl@4.15.1`, `@tanstack/react-query@5.107.1`, workspace `@trust/shared`. |
| Workspace | `web/` already listed in `pnpm-workspace.yaml`. New `web/package.json` with `dev/build/start/lint/typecheck` scripts. Next config sets `transpilePackages: ['@trust/shared']`. |
| Locales | `bn` default, `en` secondary. `localePrefix: 'always'` → `/bn/...`, `/en/...`; `/` → `/bn` via middleware. Locale lives in the URL (persistent + shareable + hreflang-able); switcher also writes `NEXT_LOCALE` cookie (1 year) so a return visit to `/` lands on the last language. |
| i18n plumbing | `src/i18n/routing.ts` (`defineRouting`), `src/i18n/request.ts` (`getRequestConfig` → `messages/{locale}.json`), `src/i18n/navigation.ts` (`createNavigation`). Middleware in `src/proxy.ts` (Next 16 proxy convention; if build reports it as unrecognised, move to `src/middleware.ts` unchanged). |
| API base | Server-only `API_BASE_URL` (default `http://localhost:4000/api/v1`); no client secret. Public reads only: `GET /listings/trending`, `/listings/search`, `/listings/:id`, `/listings/price-baseline`. `NEXT_PUBLIC_SITE_URL` (default `http://localhost:3000`) drives canonical/OG/sitemap. |
| API failure policy | Every fetch is wrapped in `safeFetch` returning `{ok:true,data}` or `{ok:false, kind:'offline'\|'error'\|'notfound'}`. No fetch failure may fail `next build`; pages render `ErrorState`/`EmptyState` instead. |
| Category slug → ObjectId | `categories._id` is deterministic: `sha256(slug).slice(0,24)` (seed.ts). `src/lib/categories.ts` (server-only) mirrors this with `node:crypto`, exposes `categoryBySlug`, `topCategories`, `localizedName`. Comment links back to `backend/scripts/seed.ts`; no backend change. |
| Caching | Home + category: ISR `revalidate = 60`. Listing detail: ISR `revalidate = 300`, `dynamicParams = true`, `generateStaticParams` → `[]` (on-demand). Search: SSR (`searchParams` → dynamic). Legal/login: static. |
| Styling | Tailwind v4 CSS-first. All tokens declared in `globals.css` under `@theme` (brand/ink/surface/border/success/warning/danger colour ramps, type scale, spacing, radius, shadows). No ad-hoc hex values in components. |
| Fonts | System stack incl. `'Hind Siliguri', 'Noto Sans Bengali', 'Noto Sans'` — no build-time font download (offline-safe, NFR-10). |
| Currency | `formatBdt(value, locale)` → `৳ ১,২৩,৪৫৬` (bn, Bengali digits) / `৳ 123,456` (en) via `Intl.NumberFormat('bn-BD'\|'en-BD')`. Single helper in `src/lib/format.ts`. |
| React Query | `QueryClientProvider` in a client `Providers` boundary; one real use: home trending rail (`initialData` from SSR, `staleTime` 5 min, refetch on focus). No client-side SEO content. |
| Login page | Public shell only: phone field + consent links + inline notice that OTP sign-in opens with the account release. No fake success, no auth call (PROMPT 18 owns the flow). `noindex` on `/login`. |
| Contact CTA | Guest sees "Log in to contact" → `/login`; phone number is never rendered (PRD §2.1). Button is a link — no dead handler. |
| Map | No API key: OpenStreetMap `https://www.openstreetmap.org/export/embed.html?bbox=…&marker=lat,lng` iframe (`loading="lazy"`, `title`), plus "Open in Google Maps" link. Rendered only when `listing.geo` exists; otherwise district-only card with an explanatory line. |
| Boosted block | `BoostedRail` above organic results/grid: only `boosted:true` cards, labelled "Sponsored/বিজ্ঞাপন"; organic grid follows. Boosted cards keep a visible badge. |
| Images | Plain `<img>` with explicit width/height when known, `loading="lazy"`, `alt` from title. No `next/image` remote-host config (signed R2 URLs rotate; avoids build/runtime host allowlist failures). |
| Accessibility | One `<h1>`/page, landmarks (`header/nav/main/footer`), skip link, visible focus rings, `aria-current` on nav, form labels, `aria-live` toast region, WCAG-AA contrast tokens. |

## 1. Files (exact)

```
web/
  package.json  tsconfig.json  next.config.ts  postcss.config.mjs  eslint.config.mjs  next-env.d.ts
  messages/{bn,en}.json
  src/
    proxy.ts
    i18n/{routing.ts,request.ts,navigation.ts}
    app/{globals.css, sitemap.ts, robots.ts, icon.svg}
    app/[locale]/
      layout.tsx  page.tsx  loading.tsx  error.tsx  not-found.tsx
      category/[slug]/page.tsx
      search/page.tsx
      listings/[id]/page.tsx
      login/page.tsx
      legal/{terms,privacy,prohibited}/page.tsx
    components/
      providers.tsx                       # QueryClientProvider + ToastProvider
      layout/{site-header.tsx,site-footer.tsx,locale-switcher.tsx,search-bar.tsx}
      ui/{button.tsx,input.tsx,modal.tsx,toast.tsx,badge.tsx,card.tsx,skeleton.tsx,empty-state.tsx}
      listings/{listing-card.tsx,listing-grid.tsx,boosted-rail.tsx,gallery.tsx,seller-card.tsx,map-embed.tsx,contact-cta.tsx,trending-rail.tsx}
      states/{error-state.tsx,offline-banner.tsx}
    lib/{api.ts,format.ts,seo.ts,categories.ts,types.ts,cn.ts}
    content/legal.ts
```

## 2. Route contracts

| Route | Render | Content |
|---|---|---|
| `/[locale]` | ISR 60s | Hero + search bar, top categories, boosted rail (trending `boosted:true`), organic trending grid, trust explainer. Empty/error/offline states. |
| `/[locale]/category/[slug]` | ISR 60s | Category header (localized name, breadcrumb), `generateStaticParams` from `CATEGORY_SEED`, listings via `/listings/search?categoryId=<derived>`, pagination links, empty state. Unknown slug → `notFound()`. |
| `/[locale]/search` | SSR | Filters (q, category, district, condition, price, sort) as GET form; results grid; `meta.total`; pagination; empty state; degraded (`X-Degraded`) notice. |
| `/[locale]/listings/[id]` | ISR 300s | Gallery, title, formatted price, condition badge, description, seller card (verified badge, member since ISO→localized date, "other listings" CTA to search by seller name is out of scope → link to `/search?q=`), map, Contact CTA, boost notice, structured data. 404 → `notFound()`; fetch failure → `ErrorState`. |
| `/[locale]/login` | static | Phone form shell + legal links + release notice; `robots: noindex`. |
| `/[locale]/legal/{terms,privacy,prohibited}` | static | Content from `content/legal.ts` (bn/en), prohibited table from `Pre-Launch_Actions.md` §A.2, retention/deletion/offline-deal disclaimers from §A.1/A.3 + PRD NFR-05. |

## 3. SEO

- Root `metadataBase = SITE_URL`; title template `%s · Trust Bazar`.
- Per page: unique `title`, `description`, `alternates.canonical` + `languages {bn,en}`, OpenGraph (`type`, `locale`, `url`, `images`), Twitter `summary_large_image`.
- Listing detail: `Product` JSON-LD (`name`, `description`, `image[]`, `offers {price, priceCurrency:'BDT', itemCondition, availability:'InStock', url}`, `brand` omitted, `seller` Organization) + `BreadcrumbList`; images omitted when none.
- `sitemap.ts`: `/bn`,`/en`, all legal, all category slugs × locales, recent listings (up to 50 via search, failures ignored), lastmod. `robots.ts`: allow `/`, disallow `/api/`, sitemap URL, host.
- `icon.svg` + `manifest` optional → skip manifest (not required).

## 4. UI kit contract

- `Button`: variants `primary|secondary|ghost|danger`, sizes `sm|md|lg`, `loading`, `asChild`-free (render `<button>`; links use `<Link className={buttonClass()}>`).
- `Input`: label, hint, error (`aria-invalid`, `aria-describedby`), optional leading slot.
- `Modal`: native `<dialog>` + backdrop, title, close on Esc/backdrop, focus return.
- `Toast`: `useToast().push({title, description?, variant})`, region `role="status" aria-live="polite"`, auto-dismiss 4s, max 3 stacked.
- `Badge`: `neutral|success|warning|danger|brand`, optional dot/icon.
- `Card`, `Skeleton` (pulse block), `EmptyState` (icon, title, description, action).

## 5. Verification (must run, paste real output)

1. `pnpm install` (web deps resolved).
2. `pnpm -C web typecheck` → 0 errors.
3. `pnpm -C web lint` → 0 errors.
4. `pnpm -C web build` → all routes compiled (static/dynamic as designed).
5. Backend up (`pnpm -C backend dev`, live Atlas) + one demo seller/listing inserted via a throwaway script **outside** the repo (`.trae/tmp/…`, deleted after) → `pnpm -C web start`; then:
   - `view-source` / `curl` of `/bn/listings/<id>` contains listing title and `৳` price (SSR).
   - `/en` contains English nav/hero copy; `/bn` contains Bangla copy; `NEXT_LOCALE` cookie set by switcher.
   - `/bn/category/mobiles-smartphones` renders listings/empty state; `/bn/search?q=…` renders results.
   - `/robots.txt`, `/sitemap.xml` respond 200 and include locale URLs.
   - Lighthouse (mobile) SEO score ≥ 90 on `/bn/listings/<id>`.
6. Regression: `pnpm typecheck` + `pnpm lint` at root; backend tests unchanged (141/141).

## 6. Doc updates (same change set)

- `prompt.md`: PROMPT 17 checkboxes ☑ + progress row 17 → ☑.
- `tasks.md`: replace with PROMPT 17 task list, all ☑ after verification.
- `checklist.md`: add PROMPT 17 verification entry.
- `.env.example`: add `API_BASE_URL`, `NEXT_PUBLIC_SITE_URL`, `WEB_PORT`.
- `API_spec.md`: **no endpoint change** (web uses existing public endpoints).

## 7. Risks / guards

- Next 16 `proxy.ts` vs `middleware.ts` naming → verify on build; fallback rename only.
- Build without a running backend → all fetches fail soft; build must still succeed (explicitly tested).
- Deterministic category id duplication → guarded by a comment + build-time assertion against `CATEGORY_SEED` slugs only.
- No secrets in client bundle (`API_BASE_URL` is server-only; only `NEXT_PUBLIC_SITE_URL` is exposed).
