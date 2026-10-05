import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configureConversation } from '../../src/gas/configuration.js';
import { googleAccessToken } from '../../src/gas/google-api.js';

let values: Map<string, string>;
let cache: Map<string, string>;
let fetcher: ReturnType<
  typeof vi.fn<
    (
      url: string,
      params: { payload?: string },
    ) => { getResponseCode(): number; getContentText(): string }
  >
>;

beforeEach(() => {
  values = new Map();
  cache = new Map();
  vi.stubGlobal('PropertiesService', {
    getScriptProperties: () => ({
      getProperty: (key: string) => values.get(key) ?? null,
      setProperty: (key: string, value: string) => values.set(key, value),
    }),
  });
  vi.stubGlobal('CacheService', {
    getScriptCache: () => ({
      get: (key: string) => cache.get(key) ?? null,
      put: (key: string, value: string) => cache.set(key, value),
      remove: (key: string) => cache.delete(key),
      removeAll: (keys: string[]) => keys.forEach((key) => cache.delete(key)),
    }),
  });
  fetcher = vi.fn().mockReturnValue({
    getResponseCode: () => 200,
    getContentText: () => JSON.stringify({ access_token: 'access-test', expires_in: 3600 }),
  });
  vi.stubGlobal('UrlFetchApp', { fetch: fetcher });
});

describe('configuração segura da conversa', () => {
  it('sincroniza credenciais necessárias sem apagar chave existente ou orçamento', () => {
    values.set('OPENAI_API_KEY', 'existing-key');
    values.set('GPT_CHAT_MONTHLY_BUDGET_USD', '1');
    cache.set('conversation.calendar-token', 'old');
    const result = configureConversation({
      GOOGLE_CLIENT_ID: 'client',
      GOOGLE_CLIENT_SECRET: 'secret',
      GOOGLE_REFRESH_TOKEN: 'refresh',
      unrelated: 'ignore',
    });
    expect(JSON.parse(result)).toEqual({
      configured: true,
      openaiKeyConfigured: true,
      dispatchConfigured: false,
    });
    expect(values.get('OPENAI_API_KEY')).toBe('existing-key');
    expect(values.get('GPT_CHAT_MONTHLY_BUDGET_USD')).toBe('1');
    expect(values.has('unrelated')).toBe(false);
    expect(cache.has('conversation.calendar-token')).toBe(false);
  });

  it('recusa configuração incompleta antes de gravar', () => {
    expect(() => configureConversation({ OPENAI_API_KEY: 'test' })).toThrow('Google ausentes');
    expect(values.size).toBe(0);
  });

  it('renova a autorização existente e reutiliza o token em cache', () => {
    configureConversation({
      GOOGLE_CLIENT_ID: 'client',
      GOOGLE_CLIENT_SECRET: 'secret',
      GOOGLE_REFRESH_TOKEN: 'refresh',
    });
    expect(googleAccessToken()).toBe('access-test');
    expect(googleAccessToken()).toBe('access-test');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://oauth2.googleapis.com/token');
    expect(fetcher.mock.calls[0]?.[1].payload).toContain('grant_type=refresh_token');
  });

  it('recusa autorização inválida e nunca guarda um token de erro', () => {
    configureConversation({
      GOOGLE_CLIENT_ID: 'client',
      GOOGLE_CLIENT_SECRET: 'secret',
      GOOGLE_REFRESH_TOKEN: 'refresh',
    });
    fetcher.mockReturnValue({ getResponseCode: () => 400, getContentText: () => '{}' });
    expect(() => googleAccessToken()).toThrow('recusada');
    expect(cache.size).toBe(0);
  });
});
