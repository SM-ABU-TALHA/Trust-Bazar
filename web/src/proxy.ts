import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

/**
 * Next.js 16 proxy (formerly middleware). Redirects `/` to `/bn`, keeps the
 * locale prefix on every public route and honours the NEXT_LOCALE cookie.
 */
export default createMiddleware(routing);

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
