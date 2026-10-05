import { describe, expect, it } from 'vitest';
import { zonedInstant } from '../../src/assistant/dates.js';
import { buildMemoryFact } from '../../src/assistant/memory.js';
import { decodeCallback, encodeCallback } from '../../src/bot/callbacks.js';
import { needsCalendar } from '../../src/bot/core.js';
import { createRenderContext } from '../../src/bot/screens.js';
import { renderView } from '../../src/bot/views.js';
import { exam, item, now } from './fixtures.js';

const buttons = (keyboard: Array<Array<{ text: string }>>) =>
  keyboard.flat().map((button) => button.text);

describe('painel novo', () => {
  it('mostra os atalhos pedidos e o assistente no menu', () => {
    const home = renderView(createRenderContext({ now, items: [item(), exam()] }), 'home');
    expect(buttons(home.keyboard)).toEqual(
      expect.arrayContaining([
        '📅 Hoje',
        '📆 Semana',
        '📝 Atividades (1)',
        '📚 Provas (1)',
        '⏰ Prazos',
        '✅ Concluídas',
        '📩 Novidades',
        '🎓 UVV',
        '📂 Materiais',
        '🤖 Perguntar',
      ]),
    );
  });

  it('desenha Hoje e Semana com Agenda, aulas da memória e o que vence', () => {
    const aula = buildMemoryFact(
      {
        category: 'aula',
        subject: 'Linguagens Formais',
        content: 'aula',
        weekdays: [1],
        startTime: '19:00',
        endTime: '22:40',
      },
      [],
      now,
    );
    const monday = new Date('2026-10-05T12:00:00Z');
    const context = createRenderContext({
      now: monday,
      items: [exam(), item({ officialDeadline: '2026-10-07T23:59:00' })],
      schedule: {
        memory: [aula],
        events: [
          {
            id: 'e1',
            title: 'Dentista',
            start: zonedInstant('2026-10-05', '14:00'),
            end: zonedInstant('2026-10-05', '15:00'),
            allDay: false,
          },
        ],
      },
    });
    const today = renderView(context, 'today').text;
    expect(today).toContain('📌 14:00–15:00 Dentista');
    expect(today).toContain('🏫 19:00–22:40 Aula de Linguagens Formais');
    expect(today).toContain('📚 Prova de Linguagens Formais (1º bim.)');
    const week = renderView(context, 'week').text;
    expect(week).toContain('<b>Quarta, 07/10</b>');
    expect(week).toContain('📝 AOP 03 — Aspectos Legais · até 23:59');
    expect(week).toContain('🌿 Livre:');
  });

  it('avisa quando não conseguiu ler a Agenda e esconde concluídas das novidades', () => {
    const fresh = item({
      title: 'Comunicado novo',
      type: 'NOTICE',
      officialDeadline: undefined,
      metadata: { origin: 'MESSAGE' },
      firstSeenAt: '2026-10-01T12:00:00Z',
    });
    const done = item({
      title: 'Comunicado lido',
      type: 'NOTICE',
      status: 'DONE',
      officialDeadline: undefined,
      metadata: { origin: 'MESSAGE' },
      firstSeenAt: '2026-10-01T12:00:00Z',
    });
    const context = createRenderContext({
      now,
      items: [fresh, done],
      schedule: { calendarError: true },
    });
    expect(renderView(context, 'today').text).toContain('Não consegui ler sua Google Agenda');
    const news = renderView(context, 'news').text;
    expect(news).toContain('Comunicado novo');
    expect(news).not.toContain('Comunicado lido');
    expect(renderView(context, 'done').text).toContain('Comunicado lido');
  });
});

describe('botões e comandos do assistente', () => {
  it('codifica confirmação e pedido de estudo dentro do limite do Telegram', () => {
    const confirm = encodeCallback({ type: 'confirm', actionId: 'abc123xyz9', accept: true });
    expect(confirm).toBe('cf|abc123xyz9|y');
    expect(decodeCallback(confirm)).toEqual({
      type: 'confirm',
      actionId: 'abc123xyz9',
      accept: true,
    });
    const assist = encodeCallback({ type: 'assist', itemId: 'UVV-055A63', intent: 'study' });
    expect(decodeCallback(assist)).toEqual({
      type: 'assist',
      itemId: 'UVV-055A63',
      intent: 'study',
    });
    expect(decodeCallback('v|deadlines|')).toEqual({
      type: 'view',
      view: 'deadlines',
      refresh: false,
    });
  });

  it('busca a Agenda só para as telas que mostram compromissos', () => {
    const tapView = (data: string) => ({
      update_id: 1,
      callback_query: { id: 'c', data, message: { message_id: 1, chat: { id: 42 } } },
    });
    expect(needsCalendar(tapView('v|today|'))).toBe(true);
    expect(needsCalendar(tapView('v|exams|'))).toBe(false);
    expect(
      needsCalendar({
        update_id: 2,
        message: { message_id: 1, chat: { id: 42 }, text: '/semana' },
      }),
    ).toBe(true);
    expect(
      needsCalendar({
        update_id: 3,
        message: { message_id: 1, chat: { id: 42 }, text: '/provas' },
      }),
    ).toBe(false);
  });
});
