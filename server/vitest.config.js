import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    env: {
      NODE_ENV: 'test',
      // Placeholder so config validation passes; tests connect through tests/helpers/db.js instead.
      MONGODB_URI: 'mongodb://127.0.0.1:27017/not-used-by-tests',
      JWT_SECRET: 'test-secret-that-is-long-enough',
      STATIC_OTP: '1234',
      OTP_MAX_ATTEMPTS: '5',
      // The tests assume these, whatever a developer's .env says.
      CONFIRMATION_TIMEOUT_MINUTES: '120',
      ENABLE_SIMULATION: 'true',
    },
    // Integration tests start an in-memory MongoDB replica set per file.
    // The first run downloads the MongoDB binary, so hooks get a generous timeout.
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
