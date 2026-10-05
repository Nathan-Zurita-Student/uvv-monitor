import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Evita falhas intermitentes de leitura de dependências com muitos processos no Windows.
    ...(process.platform === 'win32' ? { pool: 'threads' as const, maxWorkers: 1 } : {}),
    coverage: {
      reporter: ['text', 'html'],
    },
  },
});
