import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: [
        'tests/**',
        '**/*.config.*',
        'src/renderer/index.html',
      ],
      all: false,
      reporter: ['text', 'html'],
      reportsDirectory: './coverage',
    },
  },
});
