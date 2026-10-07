import { describe, expect, it, vi } from 'vitest';
import type { Page } from 'playwright';
import { collectCalendarEvents, collectServiceHistory } from '../../src/portal/collectors.js';

describe('falhas de rede das fontes', () => {
  it.each([collectServiceHistory, collectCalendarEvents])(
    'trata rejeição enquanto a navegação ainda está em andamento',
    async (collector) => {
      const error = new Error('Timeout da API');
      const page = {
        waitForResponse: vi.fn().mockImplementation(() => Promise.reject(error)),
        goto: vi
          .fn()
          .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(null), 20))),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
      } as unknown as Page;
      await expect(collector(page)).rejects.toBe(error);
    },
  );
});
