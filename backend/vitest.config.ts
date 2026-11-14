import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The suite runs against live Atlas; multi-login flows and parallel files
    // regularly exceed the 5 s default even when assertions are correct.
    testTimeout: 20_000,
  },
});
