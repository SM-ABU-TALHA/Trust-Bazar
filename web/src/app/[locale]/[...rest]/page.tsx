import { notFound } from 'next/navigation';

/** Unknown paths under a locale fall through to the localized 404 page. */
export default function CatchAll() {
  notFound();
}
