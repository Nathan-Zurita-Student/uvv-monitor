import { gzipSync, gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { doPost, processReminders } from '../../src/gas/entry.js';
import { academicItemToRow, tables, type TableName } from '../../src/persistence/rows.js';
import { item } from '../bot/fixtures.js';

let props: Map<string, string>;
let cache: Map<string, string>;
let sheets: Map<string, string[][]>;
let sent: Array<{ text?: string }>;
let requests: string[];

function sheet(name: string) {
  return {
    getDataRange: () => ({ getValues: () => sheets.get(name) ?? [] }),
    getLastRow: () => sheets.get(name)?.length ?? 0,
    appendRow: (row: string[]) => {
      sheets.set(name, [...(sheets.get(name) ?? []), row]);
    },
    getRange: (start: number, column: number, count: number, width: number) => ({
      getValues: () =>
        (sheets.get(name) ?? [])
          .slice(start - 1, start - 1 + count)
          .map((row) => row.slice(column - 1, column - 1 + width)),
      setValues: (rows: string[][]) => {
        const data = sheets.get(name) ?? [];
        rows.forEach((row, index) => {
          data[start - 1 + index] = row;
        });
        sheets.set(name, data);
      },
    }),
  };
}

function blob(bytes: Buffer) {
  return { getBytes: () => Array.from(bytes), getDataAsString: () => bytes.toString('utf8') };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-05T15:00:00Z'));
  props = new Map([
    ['TELEGRAM_BOT_TOKEN', 'test-token'],
    ['TELEGRAM_CHAT_ID', '42'],
    ['GOOGLE_SHEET_ID', 'test-sheet'],
    ['TELEGRAM_WEBHOOK_SECRET', 'test-secret'],
    ['OPENAI_API_KEY', 'test-openai'],
  ]);
  cache = new Map([['conversation.calendar-token', 'test-oauth']]);
  sheets = new Map(Object.entries(tables).map(([name, headers]) => [name, [Array.from(headers)]]));
  sheets.get('detected_items')!.push(academicItemToRow(item({ id: 'UVV-123' })));
  sent = [];
  requests = [];
  vi.stubGlobal('PropertiesService', {
    getScriptProperties: () => ({
      getProperties: () => Object.fromEntries(props),
      getProperty: (key: string) => props.get(key) ?? null,
      setProperty: (key: string, value: string) => props.set(key, value),
      deleteProperty: (key: string) => props.delete(key),
    }),
  });
  vi.stubGlobal('CacheService', {
    getScriptCache: () => ({
      get: (key: string) => cache.get(key) ?? null,
      getAll: (keys: string[]) =>
        Object.fromEntries(
          keys.filter((key) => cache.has(key)).map((key) => [key, cache.get(key)]),
        ),
      put: (key: string, value: string) => cache.set(key, value),
      putAll: (values: Record<string, string>) =>
        Object.entries(values).forEach(([key, value]) => cache.set(key, value)),
      remove: (key: string) => cache.delete(key),
      removeAll: (keys: string[]) => keys.forEach((key) => cache.delete(key)),
    }),
  });
  vi.stubGlobal('HtmlService', { createHtmlOutput: (text: string) => text });
  vi.stubGlobal('LockService', {
    getScriptLock: () => ({ waitLock: () => undefined, releaseLock: () => undefined }),
  });
  vi.stubGlobal('SpreadsheetApp', {
    openById: () => ({
      getSheetByName: (name: TableName) => (sheets.has(name) ? sheet(name) : null),
      insertSheet: (name: TableName) => {
        sheets.set(name, []);
        return sheet(name);
      },
    }),
  });
  vi.stubGlobal('Utilities', {
    newBlob: (data: string | number[]) =>
      blob(typeof data === 'string' ? Buffer.from(data) : Buffer.from(data)),
    gzip: (value: ReturnType<typeof blob>) => blob(gzipSync(Buffer.from(value.getBytes()))),
    ungzip: (value: ReturnType<typeof blob>) => blob(gunzipSync(Buffer.from(value.getBytes()))),
    base64Encode: (bytes: number[]) => Buffer.from(bytes).toString('base64'),
    base64Decode: (encoded: string) => Array.from(Buffer.from(encoded, 'base64')),
  });
  vi.stubGlobal('UrlFetchApp', {
    fetch: (url: string, params: { payload?: string }) => {
      requests.push(url);
      const payload = JSON.parse(params.payload ?? '{}') as { id?: string; text?: string };
      let result: unknown;
      if (url.includes('openai.com'))
        result = {
          status: 'completed',
          usage: { input_tokens: 3000, output_tokens: 1000 },
          output: [
            {
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    action: 'create_reminder',
                    reply: '',
                    itemId: 'UVV-123',
                    title: 'Resolver AOP',
                    description: 'Responder o questionário da AOP.',
                    date: '2026-10-09',
                    time: '14:00',
                    urgent: true,
                    durationMinutes: 30,
                    calendar: true,
                    status: null,
                  }),
                },
              ],
            },
          ],
        };
      else if (url.includes('calendar/v3')) result = { id: payload.id };
      else {
        sent.push(payload);
        result = { ok: true };
      }
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify(result) };
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function post(text: string, chat = 42, secret = 'test-secret', updateId = 123) {
  return doPost({
    parameter: { secret },
    postData: {
      contents: JSON.stringify({
        update_id: updateId,
        message: { message_id: 1, chat: { id: chat }, text },
      }),
    },
  });
}

describe('fluxo completo do webhook', () => {
  it('recebe mensagem, consulta GPT, cria agenda, persiste e envia confirmação e lembrete', () => {
    expect(post('Marca a AOP na agenda dia nove deste mês às 14h, urgente')).toBe('ok');
    expect(requests.filter((url) => url.includes('openai.com'))).toHaveLength(1);
    expect(requests.filter((url) => url.includes('calendar/v3'))).toHaveLength(1);
    expect(sent[0]?.text).toContain('Criei na sua agenda');
    expect(sheets.get('personal_reminders')?.[1]?.[3]).toBe('2026-10-09T17:00:00.000Z');
    expect(sheets.get('conversation_operations')?.[1]?.[1]).toBe('sent');
    post('Marca a AOP na agenda dia nove deste mês às 14h, urgente');
    expect(sent).toHaveLength(1);
    vi.setSystemTime(new Date('2026-10-09T17:02:00Z'));
    processReminders();
    expect(sent[1]?.text).toContain('Lembrete urgente');
    expect(sent[1]?.text).toContain('Responder o questionário');
    processReminders();
    expect(sent).toHaveLength(2);
  });

  it('não cobra nem executa ações para chat não autorizado ou segredo errado', () => {
    expect(post('marca na agenda', 99)).toBe('ok');
    expect(post('marca na agenda', 42, 'wrong')).toBe('unauthorized');
    expect(requests).toHaveLength(0);
  });

  it('mantém comandos antigos sem GPT e permite consultar gastos sem chave', () => {
    props.delete('OPENAI_API_KEY');
    post('/painel');
    post('/gastos', 42, 'test-secret', 124);
    expect(requests.some((url) => url.includes('openai.com'))).toBe(false);
    expect(sent[1]?.text).toContain('GPT neste mês');
  });

  it('aceita configuração apenas quando o segredo do webhook confere', () => {
    const body = JSON.stringify({
      uvv: 'configure_chat',
      configuration: {
        GOOGLE_CLIENT_ID: 'client',
        GOOGLE_CLIENT_SECRET: 'secret',
        GOOGLE_REFRESH_TOKEN: 'refresh',
      },
    });
    doPost({ parameter: { secret: 'wrong' }, postData: { contents: body } });
    expect(props.has('GOOGLE_REFRESH_TOKEN')).toBe(false);
    expect(
      doPost({ parameter: { secret: 'test-secret' }, postData: { contents: body } }),
    ).toContain('"configured":true');
    expect(props.get('GOOGLE_REFRESH_TOKEN')).toBe('refresh');
    expect(cache.has('conversation.calendar-token')).toBe(false);
  });
});
