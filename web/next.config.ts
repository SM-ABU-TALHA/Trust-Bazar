import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  transpilePackages: ['@trust/shared'],
  poweredByHeader: false,
  // `@trust/shared` is authored as ESM TypeScript with `.js` specifiers
  // (NodeNext style), so the bundler must map `./x.js` → `./x.ts`.
  experimental: {
    extensionAlias: {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    },
  },
};

export default withNextIntl(nextConfig);
