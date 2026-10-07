import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Limita processos e evita o reporter dinâmico que encerra silenciosamente no PowerShell.
    ...(process.platform === 'win32'
      ? { pool: 'threads' as const, maxWorkers: 2, reporters: ['verbose'] }
      : {}),
    coverage: {
      reporter: ['text', 'html'],
    },
  },
});
