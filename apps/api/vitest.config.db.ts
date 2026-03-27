import { defineConfig } from 'vitest/config';

/**
 * Vitest config for real-database integration tests.
 *
 * Requires DATABASE_URL pointing at a live PostgreSQL instance with migrations applied.
 * Run: npm run test:db
 * CI:  test-api-db job (see .github/workflows/ci.yml)
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/db/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    // DB tests must run serially — parallel runs would truncate each other's data
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
