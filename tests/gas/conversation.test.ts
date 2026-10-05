import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  conversationReminderDate,
  conversationRequest,
  conversationReservation,
  readConversationResponse,
  type ConversationPlan,
} from '../../src/bot/conversation.js';
import {
  handleConversation,
  markConversationSent,
  sendPersonalReminders,
  type ConversationStore,
} from '../../src/gas/conversation.js';
import type { TableName } from '../../src/persistence/rows.js';
import { item } from '../bot/fixtures.js';

const now = new Date('2026-10-05T15:00:00Z');
const plan: ConversationPlan = {
  action: 'create_reminder',
  reply: '',
  itemId: null,
  title: 'Revisar os capítulos',
  description: 'Revisar capítulos 1 e 2 e resolver a lista de exercícios.',
  date: '2026-10-09',
  time: '14:00',
  urgent: true,
  durationMinutes: 30,
  calendar: true,
  status: null,
};

let props: Map<string, string>;
let rows: Map<TableName, string[][]>;
type TestResponse = { getResponseCode(): number; getContentText(): string };
let fetcher: ReturnType<typeof vi.fn<(url: string, params: { payload?: string }) => TestResponse>>;
let store: ConversationStore;

function response(body: unknown, status = 200) {
  return { getResponseCode: () => status, getContentText: () => JSON.stringify(body) };
}

function spent(): number {
  return (JSON.parse(props.get('GPT_CHAT_USAGE')!) as { spent: number }).spent;
}

function gptResponse(value: ConversationPlan = plan) {
  return response({
    status: 'completed',
    output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
    usage: { input_tokens: 3000, output_tokens: 1000 },
  });
}

function input(overrides = {}) {
  return {
    text: 'Marca na agenda pro dia nove desse mês às 14h, urgente, para revisar os capítulos',
    updateId: 123,
    chatId: '42',
    items: [item({ id: 'UVV-123' })],
    now,
    store,
    ...overrides,
  };
}

beforeEach(() => {
  props = new Map([['OPENAI_API_KEY', 'test-key']]);
  rows = new Map();
  store = {
    rows: (name) => rows.get(name) ?? [],
    upsert: (name, row) => {
      const existing = rows.get(name) ?? [];
      rows.set(name, [...existing.filter((entry) => entry[0] !== row[0]), row]);
    },
  };
  vi.stubGlobal('PropertiesService', {
    getScriptProperties: () => ({
      getProperty: (key: string) => props.get(key) ?? null,
      setProperty: (key: string, value: string) => props.set(key, value),
      deleteProperty: (key: string) => props.delete(key),
    }),
  });
  vi.stubGlobal('ScriptApp', { getOAuthToken: () => 'oauth-test' });
  vi.stubGlobal('CacheService', { getScriptCache: () => ({ get: () => 'oauth-test' }) });
  fetcher = vi.fn((url: string, params: { payload?: string }) => {
    if (url.includes('openai.com')) return gptResponse();
    const body = JSON.parse(params.payload ?? '{}') as { id: string };
    return response({ id: body.id });
  });
  vi.stubGlobal('UrlFetchApp', { fetch: fetcher });
});

describe('conversa GPT no webhook', () => {
  it('cria evento no horário de São Paulo, urgente, com instruções e aviso no Telegram', () => {
    const result = handleConversation(input());
    expect(result.reply).toContain('Criei na sua agenda');
    expect(result.reply).toContain('09/10/2026');
    const event = JSON.parse(fetcher.mock.calls[1]![1].payload!) as {
      start: { dateTime: string };
      end: { dateTime: string };
      colorId: string;
      description: string;
      attendees?: unknown;
    };
    expect(event.start.dateTime).toBe('2026-10-09T17:00:00.000Z');
    expect(event.end.dateTime).toBe('2026-10-09T17:30:00.000Z');
    expect(event.colorId).toBe('11');
    expect(event.description).toContain('Revisar capítulos 1 e 2');
    expect(event.attendees).toBeUndefined();
    expect(rows.get('personal_reminders')?.[0]?.[3]).toBe('2026-10-09T17:00:00.000Z');
    expect(spent()).toBeCloseTo(0.00675);
  });

  it('não usa Calendar para pedidos só de Telegram e conserva memória para continuação', () => {
    fetcher.mockReturnValue(gptResponse({ ...plan, calendar: false }));
    handleConversation(input());
    handleConversation(input({ text: 'E o que eu estudo primeiro?', updateId: 124 }));
    expect(fetcher).toHaveBeenCalledTimes(2);
    const request = JSON.parse(fetcher.mock.calls[1]![1].payload!) as {
      input: string;
      model: string;
      store: boolean;
    };
    expect(
      (JSON.parse(request.input) as { recentConversation: unknown[] }).recentConversation,
    ).toHaveLength(2);
    expect(request.model).toBe('gpt-5.4-mini');
    expect(request.store).toBe(false);
  });

  it('não repete chamadas nem eventos quando o Telegram entrega o mesmo update', () => {
    handleConversation(input());
    const replay = handleConversation(input());
    expect(replay.reply).toContain('Criei na sua agenda');
    expect(fetcher).toHaveBeenCalledTimes(2);
    markConversationSent(store, 123);
    expect(handleConversation(input()).replay).toBe(true);
    expect(rows.get('personal_reminders')).toHaveLength(1);
  });

  it('recupera evento já inserido antes de uma falha de persistência sem duplicar', () => {
    let failed = false;
    const original = store.upsert.bind(store);
    store.upsert = (name, row) => {
      if (name === 'personal_reminders' && !failed) {
        failed = true;
        throw new Error('sheet offline');
      }
      original(name, row);
    };
    expect(() => handleConversation(input())).toThrow('sheet offline');
    fetcher.mockImplementation((url: string) =>
      url.endsWith('/uvv123')
        ? response({
            id: 'uvv123',
            extendedProperties: { private: { uvvChatId: '42', uvvTelegramUpdate: '123' } },
          })
        : response({}, 409),
    );
    expect(handleConversation(input()).reply).toContain('Criei na sua agenda');
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(rows.get('personal_reminders')).toHaveLength(1);
  });

  it('não confirma a criação quando o Calendar rejeita o evento', () => {
    fetcher.mockImplementation((url: string) =>
      url.includes('openai.com') ? gptResponse() : response({}, 403),
    );
    expect(() => handleConversation(input())).toThrow('Não consegui gravar');
    expect(rows.get('personal_reminders')).toBeUndefined();
    expect(rows.get('conversation_operations')?.[0]?.[1]).toBe('planned');
  });

  it('pergunta sem criar nada quando a resposta é uma solicitação de esclarecimento', () => {
    fetcher.mockReturnValue(
      gptResponse({
        ...plan,
        action: 'reply',
        reply: 'De qual atividade você quer que eu te lembre?',
      }),
    );
    expect(handleConversation(input()).reply).toContain('De qual atividade');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(rows.get('personal_reminders')).toBeUndefined();
  });

  it('muda apenas o status da tarefa identificada e recusa IDs inventados', () => {
    fetcher.mockReturnValue(
      gptResponse({ ...plan, action: 'set_status', itemId: 'UVV-123', status: 'DONE' }),
    );
    expect(handleConversation(input()).reply).toContain('concluída');
    expect(rows.get('user_task_status')?.[0]?.[1]).toBe('DONE');
    fetcher.mockReturnValue(gptResponse({ ...plan, itemId: 'inventado' }));
    expect(() => handleConversation(input({ updateId: 124 }))).toThrow('Não encontrei');
  });

  it('recusa uma operação incompleta e datas passadas ou impossíveis', () => {
    expect(() => conversationReminderDate({ ...plan, title: null }, now)).toThrow('Me diga');
    expect(() => conversationReminderDate({ ...plan, date: '2026-10-01' }, now)).toThrow(
      'já passou',
    );
    expect(() => conversationReminderDate({ ...plan, date: '2027-02-31' }, now)).toThrow(
      'não é válido',
    );
    expect(() => conversationReminderDate({ ...plan, time: '25:00' }, now)).toThrow('não é válido');
  });

  it('bloqueia antes de cobrar quando orçamento ou limite diário terminam', () => {
    props.set('GPT_CHAT_MONTHLY_BUDGET_USD', '0.001');
    expect(() => handleConversation(input())).toThrow('limite de gasto');
    expect(fetcher).not.toHaveBeenCalled();
    props.set('GPT_CHAT_MONTHLY_BUDGET_USD', '2.5');
    props.set(
      'GPT_CHAT_USAGE',
      JSON.stringify({ month: '2026-10', spent: 0, day: '2026-10-05', callsToday: 30 }),
    );
    expect(() => handleConversation(input())).toThrow('limite de conversas');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reinicia limites no mês/dia local e preserva gastos quando só o dia muda', () => {
    props.set(
      'GPT_CHAT_USAGE',
      JSON.stringify({ month: '2026-09', spent: 2.49, day: '2026-09-30', callsToday: 30 }),
    );
    handleConversation(input());
    expect(spent()).toBeCloseTo(0.00675);
    props.set(
      'GPT_CHAT_USAGE',
      JSON.stringify({ month: '2026-10', spent: 1, day: '2026-10-04', callsToday: 30 }),
    );
    handleConversation(input({ updateId: 125 }));
    expect(spent()).toBeCloseTo(1.00675);
  });

  it('mantém uma reserva conservadora em timeout ou consumo inválido', () => {
    fetcher.mockImplementation(() => {
      throw new Error('timeout');
    });
    expect(() => handleConversation(input())).toThrow('timeout');
    expect(spent()).toBeGreaterThan(0);
    expect(rows.get('personal_reminders')).toBeUndefined();
  });

  it('gastos e esquecer não gastam tokens e limpeza não apaga lembretes', () => {
    props.set('GPT_CHAT_HISTORY', 'history');
    expect(handleConversation(input({ text: '/gastos' })).reply).toContain('US$ 2.50');
    expect(handleConversation(input({ text: '/esquecer' })).reply).toContain('continuam valendo');
    expect(props.has('GPT_CHAT_HISTORY')).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('recusa GPT sem chave ou quando estiver pausado', () => {
    props.delete('OPENAI_API_KEY');
    expect(() => handleConversation(input())).toThrow('chave OpenAI');
    props.set('OPENAI_API_KEY', 'test');
    props.set('GPT_CHAT_ENABLED', 'false');
    expect(() => handleConversation(input())).toThrow('pausada');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('envia aviso urgente com instruções e não marca como enviado em falha', () => {
    handleConversation(input());
    const later = new Date('2026-10-09T17:01:00Z');
    const sender = vi.fn<(text: string) => void>(() => {
      throw new Error('Telegram offline');
    });
    expect(() => sendPersonalReminders(store, '42', [], later, sender)).toThrow('Telegram offline');
    expect(rows.get('personal_reminders')?.[0]?.[8]).toBe('');
    sender.mockImplementation(() => undefined);
    sendPersonalReminders(store, '42', [], later, sender);
    expect(sender.mock.calls[1]?.[0]).toContain('Lembrete urgente');
    expect(rows.get('personal_reminders')?.[0]?.[8]).toBe(later.toISOString());
    sendPersonalReminders(store, '42', [], later, sender);
    expect(sender).toHaveBeenCalledTimes(2);
  });

  it('não envia lembretes para outro chat nem de tarefas já concluídas', () => {
    fetcher.mockReturnValue(gptResponse({ ...plan, calendar: false, itemId: 'UVV-123' }));
    handleConversation(input());
    const sender = vi.fn();
    sendPersonalReminders(store, '99', [], new Date('2026-10-09T17:01:00Z'), sender);
    sendPersonalReminders(
      store,
      '42',
      [item({ id: 'UVV-123', status: 'DONE' })],
      new Date('2026-10-09T17:01:00Z'),
      sender,
    );
    expect(sender).not.toHaveBeenCalled();
  });

  it('limita contexto, remove segredos e usa o dia local próximo da meia-noite', () => {
    const request = conversationRequest(
      'me lembra',
      Array.from({ length: 100 }, () => item({ description: 'x'.repeat(3000) })),
      [],
      new Date('2026-10-06T01:00:00Z'),
    );
    expect((JSON.parse(String(request.input)) as { localDate: string }).localDate).toBe(
      '2026-10-05',
    );
    expect(String(request.input).length + String(request.instructions).length).toBeLessThanOrEqual(
      18000,
    );
    expect(conversationReservation(request)).toBeGreaterThan(0.0063);
    const secretRequest = conversationRequest(
      'meu email é teste@example.com e minha chave sk-123456789012345',
      [],
      [],
      now,
    );
    expect(String(secretRequest.input)).not.toContain('teste@example.com');
    expect(String(secretRequest.input)).not.toContain('sk-123456789012345');
  });

  it('rejeita respostas incompletas ou recusadas do GPT', () => {
    expect(() => readConversationResponse({ status: 'incomplete' })).toThrow('concluir');
    expect(() =>
      readConversationResponse({
        status: 'completed',
        output: [{ content: [{ type: 'refusal' }] }],
      }),
    ).toThrow('não retornou');
  });
});
