import { gzipSync, gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { doPost, processReminders } from '../../src/gas/entry.js';
import { classSlotToRow } from '../../src/models/class-schedule.js';
import { portalDocumentToRow } from '../../src/models/portal-document.js';
import { academicItemToRow, tables, type TableName } from '../../src/persistence/rows.js';
import { exam, item } from '../bot/fixtures.js';

let props: Map<string, string>;
let cache: Map<string, string>;
let sheets: Map<string, string[][]>;
/** Linhas como chegaram ao appendRow, antes de virar texto no armazenamento falso. */
let appended: Array<{ name: string; row: Array<string | number> }>;
let telegramCalls: Array<{ method: string; payload: Record<string, unknown> }>;
let requests: Array<{ method: string; url: string; body?: string }>;
let openAiReplies: unknown[];
let calendarEvents: Array<Record<string, unknown>>;

const messages = () => telegramCalls.filter((call) => call.method === 'sendMessage');

function sheet(name: string) {
  return {
    getDataRange: () => ({ getValues: () => sheets.get(name) ?? [] }),
    getLastRow: () => sheets.get(name)?.length ?? 0,
    appendRow: (row: Array<string | number>) => {
      appended.push({ name, row });
      sheets.set(name, [...(sheets.get(name) ?? []), row.map(String)]);
    },
    deleteRow: (row: number) => {
      sheets.get(name)?.splice(row - 1, 1);
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

function functionCall(name: string, args: Record<string, unknown>) {
  return {
    status: 'completed',
    usage: { input_tokens: 3000, output_tokens: 50, input_tokens_details: { cached_tokens: 2000 } },
    output: [
      { type: 'function_call', call_id: `call-${name}`, name, arguments: JSON.stringify(args) },
    ],
  };
}

function finalReply(reply: string) {
  return {
    status: 'completed',
    usage: { input_tokens: 3500, output_tokens: 80 },
    output: [
      {
        type: 'message',
        content: [{ type: 'output_text', text: JSON.stringify({ reply, referenced: [] }) }],
      },
    ],
  };
}

function respond(body: unknown, status = 200) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { getResponseCode: () => status, getContentText: () => text };
}

function fetchStub(url: string, params: { method?: string; payload?: string } = {}) {
  const method = params.method ?? 'get';
  requests.push({ method, url, ...(params.payload ? { body: params.payload } : {}) });
  if (url.includes('openai.com')) return respond(openAiReplies.shift() ?? finalReply('ok'));
  if (url.includes('api.github.com')) return respond('', 204);
  if (url.includes('oauth2.googleapis.com'))
    return respond({ access_token: 'token', expires_in: 3600 });
  if (url.includes('calendar/v3')) {
    const id = /\/events\/([^?/]+)/.exec(url)?.[1];
    if (method === 'delete') return respond('', 204);
    if (method === 'get' && id) {
      const found = calendarEvents.find((event) => event.id === id);
      return found ? respond(found) : respond({}, 404);
    }
    if (method === 'get') return respond({ items: calendarEvents });
    const body = JSON.parse(params.payload ?? '{}') as Record<string, unknown>;
    return respond({ id: id ?? 'created-1', status: 'confirmed', ...body });
  }
  const telegramMethod = url.split('/').pop() ?? '';
  telegramCalls.push({
    method: telegramMethod,
    payload: JSON.parse(params.payload ?? '{}') as Record<string, unknown>,
  });
  return respond({ ok: true, result: {} });
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
    ['GOOGLE_CLIENT_ID', 'client'],
    ['GOOGLE_CLIENT_SECRET', 'secret'],
    ['GOOGLE_REFRESH_TOKEN', 'refresh'],
    ['ASSISTANT_PROACTIVE', 'false'],
  ]);
  cache = new Map();
  sheets = new Map(Object.entries(tables).map(([name, headers]) => [name, [Array.from(headers)]]));
  appended = [];
  sheets.get('detected_items')!.push(academicItemToRow(item({ id: 'UVV-123' })));
  sheets
    .get('run_history')!
    .push([
      'run-fresh',
      '2026-10-05T14:35:00Z',
      '2026-10-05T14:50:00Z',
      'SUCCESS',
      'SUCCESS',
      'SUCCESS',
      '1',
      '[]',
    ]);
  telegramCalls = [];
  requests = [];
  openAiReplies = [];
  calendarEvents = [];
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
  vi.stubGlobal('ContentService', {
    MimeType: { JSON: 'json' },
    createTextOutput: (text: string) => ({ setMimeType: () => text }),
  });
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
    base64DecodeWebSafe: (encoded: string) => Array.from(Buffer.from(encoded, 'base64url')),
    sleep: () => undefined,
    getUuid: () => '11111111-1111-4111-8111-111111111111',
  });
  vi.stubGlobal('UrlFetchApp', {
    fetch: fetchStub,
    fetchAll: (list: Array<{ url: string; method?: string }>) =>
      list.map((entry) => fetchStub(entry.url, entry)),
  });
});

describe('envio diário agendado', () => {
  const digestPost = (token: string) =>
    doPost({ postData: { contents: JSON.stringify({ uvv: 'daily_digest', token }) } });

  it('usa credencial separada e rejeita a chave normal do webhook', () => {
    props.set('DAILY_DIGEST_TOKEN', 'x'.repeat(64));
    props.set('DAILY_DIGEST_ENABLED', 'true');
    expect(digestPost('test-secret')).toBe('unauthorized');
    expect(messages()).toHaveLength(0);
    expect(digestPost('x'.repeat(64))).toBe('sent');
    expect(messages()).toHaveLength(1);
  });

  it('chamadas repetidas e fallback não duplicam; outro horário envia de novo', () => {
    props.set('DAILY_DIGEST_TOKEN', 'x'.repeat(64));
    props.set('DAILY_DIGEST_ENABLED', 'true');
    expect(digestPost('x'.repeat(64))).toBe('sent');
    cache.clear(); // cache efêmero não é o comprovante
    expect(digestPost('x'.repeat(64))).toBe('idle');
    processReminders();
    expect(messages()).toHaveLength(1);
    vi.setSystemTime(new Date('2026-10-05T20:00:00Z'));
    sheets
      .get('run_history')!
      .push([
        'run-17',
        '2026-10-05T19:35:00Z',
        '2026-10-05T19:50:00Z',
        'SUCCESS',
        'SUCCESS',
        'SUCCESS',
        '1',
        '[]',
      ]);
    expect(digestPost('x'.repeat(64))).toBe('sent');
    expect(messages()).toHaveLength(2);
  });

  it('inicia a varredura e espera a coleta deste horário antes de entregar', () => {
    props.set('DAILY_DIGEST_TOKEN', 'x'.repeat(64));
    props.set('DAILY_DIGEST_ENABLED', 'true');
    props.set('MONITOR_DISPATCH_TOKEN', 'github-token');
    sheets.set('run_history', [Array.from(tables.run_history)]);

    expect(digestPost('x'.repeat(64))).toBe('waiting');
    expect(messages()).toHaveLength(0);
    expect(requests.filter((request) => request.url.includes('api.github.com'))).toHaveLength(1);
    expect(props.get('MONITOR_LAST_DISPATCH')).toBe('2026-10-05 12:00');

    vi.setSystemTime(new Date('2026-10-05T15:08:00Z'));
    sheets
      .get('run_history')!
      .push([
        'run-current',
        '2026-10-05T14:55:00Z',
        '2026-10-05T15:08:00Z',
        'SUCCESS',
        'SUCCESS',
        'SUCCESS',
        '1',
        '[]',
      ]);
    expect(
      doPost({
        parameter: { secret: 'test-secret' },
        postData: { contents: JSON.stringify({ uvv: 'refresh' }) },
      }),
    ).toBe('ok');
    expect(messages()).toHaveLength(1);
    expect(messages()[0]?.payload.text).toContain('Última coleta finalizada: seg, 05/10 · 12h08');
    expect(messages()[0]?.payload.text).not.toContain('dados anteriores');
  });

  it('falha de Telegram não marca entregue e permite tentar novamente', () => {
    props.set('DAILY_DIGEST_TOKEN', 'x'.repeat(64));
    props.set('DAILY_DIGEST_ENABLED', 'true');
    vi.stubGlobal('UrlFetchApp', { fetch: () => respond('falha temporária', 500) });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    digestPost('x'.repeat(64));
    expect(props.has('digest.sent.2026-10-05 12:00')).toBe(false);
    vi.stubGlobal('UrlFetchApp', { fetch: fetchStub });
    expect(digestPost('x'.repeat(64))).toBe('sent');
    expect(props.has('digest.sent.2026-10-05 12:00')).toBe(true);
    consoleError.mockRestore();
  });

  it('relê status e mostra a situação parcial da última coleta', () => {
    props.set('DAILY_DIGEST_TOKEN', 'x'.repeat(64));
    props.set('DAILY_DIGEST_ENABLED', 'true');
    sheets.get('user_task_status')!.push(['UVV-123', 'DONE', new Date().toISOString(), 'TELEGRAM']);
    sheets.set('run_history', [
      Array.from(tables.run_history),
      [
        'run',
        '2026-10-05T14:40:00Z',
        '2026-10-05T14:50:00Z',
        'PARTIAL',
        'SUCCESS',
        'SUCCESS',
        '1',
        '[]',
      ],
    ]);
    expect(digestPost('x'.repeat(64))).toBe('sent');
    expect(messages()[0]?.payload.text).toContain('Portal/AVA verificado parcialmente');
    expect(messages()[0]?.payload.text).not.toContain('Atividade Online Pontuada');
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

function tap(data: string, updateId: number) {
  return doPost({
    parameter: { secret: 'test-secret' },
    postData: {
      contents: JSON.stringify({
        update_id: updateId,
        callback_query: {
          id: `cb${String(updateId)}`,
          data,
          message: { message_id: 9, chat: { id: 42 } },
        },
      }),
    },
  });
}

describe('assistente no webhook', () => {
  it('entende o pedido, usa a ferramenta, grava o lembrete, registra o log e avisa no horário', () => {
    openAiReplies = [
      functionCall('create_reminder', {
        title: 'Resolver AOP',
        description: 'Responder o questionário da AOP.',
        date: '2026-10-09',
        time: '14:00',
        related_item_id: 'UVV-123',
        urgent: true,
      }),
      finalReply('Combinado! Te lembro sexta (09/10) às 14h.'),
    ];
    expect(post('me lembra da AOP sexta às 14h, é urgente')).toBe('ok');
    expect(telegramCalls[0]).toMatchObject({
      method: 'sendChatAction',
      payload: { action: 'typing' },
    });
    expect(messages()[0]?.payload.text).toBe('Combinado! Te lembro sexta (09/10) às 14h.');
    expect(requests.filter((request) => request.url.includes('openai.com'))).toHaveLength(2);
    const firstRequest = JSON.parse(
      requests.find((request) => request.url.includes('openai.com'))!.body!,
    ) as {
      tools: Array<{ name: string }>;
      input: Array<{ role?: string; content?: string }>;
    };
    expect(firstRequest.tools.map((tool) => tool.name)).toContain('create_reminder');
    expect(firstRequest.input[0]?.content).toContain('Datas de referência');
    const reminder = sheets.get('personal_reminders')?.[1];
    expect(reminder?.[3]).toBe('2026-10-09T17:00:00.000Z');
    expect(reminder?.[6]).toBe('UVV-123');
    const log = sheets.get('assistant_log')?.[1];
    expect(log?.[3]).toBe('["create_reminder"]');
    expect(log?.[11]).toBe('ok');
    expect(Number(log?.[9])).toBeGreaterThan(0);
    // Custo vai como número: em texto, a planilha pt-BR leria "0.0047" como 47.
    const rawLog = appended.find((entry) => entry.name === 'assistant_log')?.row;
    expect(typeof rawLog?.[9]).toBe('number');
    expect(JSON.stringify(sheets.get('assistant_log'))).not.toContain('test-openai');

    // Reentrega do mesmo update: nada é refeito.
    post('me lembra da AOP sexta às 14h, é urgente');
    expect(messages()).toHaveLength(1);

    vi.setSystemTime(new Date('2026-10-09T17:02:00Z'));
    processReminders();
    expect(messages()[1]?.payload.text).toContain('Lembrete urgente');
    expect(messages()[1]?.payload.text).toContain('Resolver AOP');
    processReminders();
    expect(messages()).toHaveLength(2);
  });

  it('pede confirmação antes de remover um evento e executa no botão', () => {
    calendarEvents = [
      {
        id: 'estudo1',
        status: 'confirmed',
        summary: '📚 Estudar',
        start: { dateTime: '2026-10-06T17:00:00Z' },
        end: { dateTime: '2026-10-06T18:30:00Z' },
        extendedProperties: { private: { uvvAssistant: '1' } },
      },
    ];
    openAiReplies = [
      functionCall('delete_calendar_event', { event_id: 'estudo1' }),
      finalReply('Vou tirar o estudo de amanhã às 14h. É só tocar em Confirmar.'),
    ];
    post('remove o estudo de amanhã');
    const keyboard = messages()[0]?.payload.reply_markup as {
      inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
    };
    expect(keyboard.inline_keyboard[0]?.[0]?.text).toBe('✅ Confirmar');
    expect(requests.some((request) => request.method === 'delete')).toBe(false);
    tap(keyboard.inline_keyboard[0]![0]!.callback_data, 124);
    expect(requests.filter((request) => request.method === 'delete')).toHaveLength(1);
    expect(messages().at(-1)?.payload.text).toContain('tirei "📚 Estudar" da sua Agenda');
  });

  it('confirma por texto ("sim") sem gastar uma chamada ao GPT', () => {
    calendarEvents = [
      {
        id: 'estudo1',
        summary: '📚 Estudar',
        start: { dateTime: '2026-10-06T17:00:00Z' },
        end: { dateTime: '2026-10-06T18:30:00Z' },
      },
    ];
    openAiReplies = [
      functionCall('delete_calendar_event', { event_id: 'estudo1' }),
      finalReply('Confirma?'),
    ];
    post('apaga o estudo');
    const calls = requests.filter((request) => request.url.includes('openai.com')).length;
    post('sim', 42, 'test-secret', 125);
    expect(requests.filter((request) => request.url.includes('openai.com'))).toHaveLength(calls);
    expect(messages().at(-1)?.payload.text).toContain('tirei');
  });

  it('não cobra nem executa nada para chat não autorizado ou segredo errado', () => {
    expect(post('marca na agenda', 99)).toBe('ok');
    expect(post('marca na agenda', 42, 'wrong')).toBe('unauthorized');
    expect(requests).toHaveLength(0);
  });

  it('mantém comandos e telas sem GPT, inclusive /gastos sem chave', () => {
    props.delete('OPENAI_API_KEY');
    post('/painel');
    post('/gastos', 42, 'test-secret', 124);
    expect(requests.some((request) => request.url.includes('openai.com'))).toBe(false);
    expect(messages()[1]?.payload.text).toContain('GPT neste mês');
  });

  it('desenha a tela Hoje com a Google Agenda e o que vence', () => {
    calendarEvents = [
      {
        id: 'dentista',
        summary: 'Dentista',
        start: { dateTime: '2026-10-05T20:00:00Z' },
        end: { dateTime: '2026-10-05T21:00:00Z' },
      },
    ];
    tap('v|today|', 130);
    const edit = telegramCalls.find((call) => call.method === 'editMessageText');
    expect(edit?.payload.text).toContain('📅 <b>Hoje</b>');
    expect(edit?.payload.text).toContain('17:00–18:00 Dentista');
    expect(requests.some((request) => request.url.includes('calendar/v3'))).toBe(true);
  });

  it('reenvia o arquivo do professor pelo file_id e mostra a aula do quadro em Hoje', () => {
    sheets.get('portal_documents')!.push(
      portalDocumentToRow({
        id: 'doc:U3',
        postExternalId: 'post:1',
        discipline: 'Cálculo Numérico Computacional',
        postTitle: 'Unidade 03',
        publishedOn: '2026-09-21',
        fileName: 'Unidade_03.pdf',
        url: 'x',
        contentType: 'application/pdf',
        sizeBytes: 1,
        sha256: 'a',
        pages: 57,
        status: 'lido',
        fetchedAt: '2026-10-05T12:00:00Z',
        telegramFileId: 'file-u3',
        sentAt: '2026-10-05T12:00:00Z',
      }),
    );
    sheets.get('class_schedule')!.push(
      classSlotToRow(
        {
          code: 'DESENV',
          discipline: 'Desenvolvimento Mobile',
          weekday: 1,
          startTime: '19:10',
          endTime: '20:50',
          online: false,
          period: '2026/2',
        },
        '2026-10-05T12:00:00Z',
      ),
    );
    tap('mf|f|doc:U3', 140);
    expect(telegramCalls.find((call) => call.method === 'sendDocument')?.payload).toMatchObject({
      document: 'file-u3',
      caption: 'Unidade 03 · 21/09',
    });
    tap('v|today|', 141);
    const edit = telegramCalls.find((call) => call.method === 'editMessageText');
    expect(edit?.payload.text).toContain('19:10–20:50 Aula de Desenvolvimento Mobile');
  });

  it('envia um único aviso proativo por dia, com botão para organizar o estudo', () => {
    props.set('ASSISTANT_PROACTIVE', 'true');
    sheets
      .get('detected_items')!
      .push(academicItemToRow(exam({ id: 'UVV-PROVA1', officialDate: '2026-10-07' })));
    processReminders();
    const nudge = messages()[0];
    expect(nudge?.payload.text).toContain('não encontrei nenhum horário de estudo');
    expect(JSON.stringify(nudge?.payload.reply_markup)).toContain('as|UVV-PROVA1|study');
    processReminders();
    expect(messages()).toHaveLength(1);
  });

  it('aceita configuração apenas quando o segredo do webhook confere', () => {
    props.delete('GOOGLE_REFRESH_TOKEN');
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
  });
});
