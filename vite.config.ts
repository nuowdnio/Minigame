import { defineConfig } from 'vite';

export default defineConfig({
  // relative Pfade, damit der Build auf jedem statischen Hoster (z. B. GitHub Pages) läuft
  base: './',
  server: { host: true },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
} as any);
