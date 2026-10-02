import { describe, expect, it } from 'vitest';
import { encodeCallback, type CallbackAction } from '../../src/bot/callbacks.js';
import {
  dueReminders,
  handleUpdate,
  quickAnswer,
  referencedData,
  type BotEffect,
} from '../../src/bot/core.js';
import { createRenderContext } from '../../src/bot/screens.js';
import type { AcademicItem } from '../../src/models/academic-item.js';
import type { TelegramBatch } from '../../src/models/bot.js';
import type { TelegramUpdate } from '../../src/telegram/types.js';
import { chatId, exam, item, now } from './fixtures.js';

const aop = item();
const prova = exam();
const batch: TelegramBatch = {
  batchId: 'ab12cd34',
  createdAt: now.toISOString(),
  entries: [
    { itemId: aop.id, reason: 'new' },
    { itemId: prova.id, reason: 'urgent' },
  ],
};

function tap(action: CallbackAction): TelegramUpdate {
  return {
    update_id: 1,
    callback_query: {
      id: 'callback-1',
      data: encodeCallback(action),
      message: { message_id: 99, chat: { id: Number(chatId) } },
    },
  };
}

function click(
  action: CallbackAction,
  items: AcademicItem[] = [aop, prova],
  answered = false,
): BotEffect[] {
  const context = createRenderContext({ now, items, batches: [batch] });
  return handleUpdate(tap(action), { chatId, context, ...(answered ? { answered } : {}) }, now);
}

function message(text: string, pending?: Parameters<typeof handleUpdate>[1]['pending']) {
  const context = createRenderContext({ now, items: [aop, prova] });
  return handleUpdate(
    { update_id: 2, message: { message_id: 5, chat: { id: Number(chatId) }, text } },
    { chatId, context, ...(pending ? { pending } : {}) },
    now,
  );
}

const find = <T extends BotEffect['type']>(effects: BotEffect[], type: T) =>
  effects.find((effect): effect is Extract<BotEffect, { type: T }> => effect.type === type);

describe('botões das atividades', () => {
  it('conclui na hora, responde e atualiza a própria mensagem com Desfazer', () => {
    const effects = click({
      type: 'status',
      itemId: aop.id,
      status: 'DONE',
      undo: false,
      screen: { kind: 'card', context: 'new' },
    });
    expect(find(effects, 'setStatus')?.record).toMatchObject({
      itemId: aop.id,
      status: 'DONE',
      previousStatus: 'TODO',
      completedAt: now.toISOString(),
    });
    expect(find(effects, 'answer')?.text).toMatch(/^✅/);
    const edit = find(effects, 'edit');
    expect(edit?.messageId).toBe(99);
    expect(edit?.text).toContain('✅ Concluída');
    expect(edit?.text).not.toContain(aop.id);
    const buttons = edit?.keyboard.flat().map((button) => button.text);
    expect(buttons).toContain('↩️ Desfazer');
    expect(buttons).not.toContain('✅ Concluir');
  });

  it('desfaz voltando ao status anterior', () => {
    const done = { ...aop, status: 'DONE' as const };
    const effects = click(
      {
        type: 'status',
        itemId: aop.id,
        status: 'TODO',
        undo: true,
        screen: { kind: 'card', context: 'new' },
      },
      [done, prova],
    );
    expect(find(effects, 'setStatus')?.record.status).toBe('TODO');
    expect(find(effects, 'answer')?.text).toMatch(/^↩️/);
    expect(
      find(effects, 'edit')
        ?.keyboard.flat()
        .map((button) => button.text),
    ).toContain('✅ Concluir');
  });

  it('ignora sem pedir confirmação e registra quando', () => {
    const effects = click({
      type: 'status',
      itemId: aop.id,
      status: 'IGNORED',
      undo: false,
      screen: { kind: 'detail', from: 'tasks' },
    });
    expect(find(effects, 'setStatus')?.record.ignoredAt).toBe(now.toISOString());
    expect(find(effects, 'edit')?.text).toContain('🙈 Ignorada');
  });

  it('abre o menu de lembrete e agenda um lembrete', () => {
    const menu = click({
      type: 'remindMenu',
      itemId: aop.id,
      screen: { kind: 'card', context: 'new' },
    });
    const options = find(menu, 'editKeyboard')
      ?.keyboard.flat()
      .map((button) => button.text);
    expect(options).toEqual(
      expect.arrayContaining([
        '30 min',
        '1 hora',
        'Hoje à noite',
        'Amanhã cedo',
        '1 dia antes',
        '🕒 Escolher horário',
        '↩️ Voltar',
      ]),
    );
    const effects = click({
      type: 'remind',
      itemId: aop.id,
      option: 'night',
      screen: { kind: 'card', context: 'new' },
    });
    expect(find(effects, 'setReminder')?.reminder).toMatchObject({
      itemId: aop.id,
      remindAt: '2026-10-02T23:00:00.000Z',
      chatId,
    });
    expect(find(effects, 'answer')?.text).toBe('⏰ Combinado! Te lembro hoje às 20:00.');
    expect(find(effects, 'edit')?.text).toContain('⏰ Lembrete marcado: hoje às 20:00');
  });

  it('pede o horário livre e entende a resposta', () => {
    const effects = click({
      type: 'remind',
      itemId: aop.id,
      option: 'custom',
      screen: { kind: 'card', context: 'new' },
    });
    expect(find(effects, 'send')?.forceReply).toBe(true);
    const pending = find(effects, 'setPending')?.pending;
    expect(pending).toMatchObject({ itemId: aop.id, messageId: 99 });
    const reply = message('amanhã 9h', pending);
    expect(find(reply, 'setReminder')?.reminder.remindAt).toBe('2026-10-03T12:00:00.000Z');
    expect(find(reply, 'send')?.text).toContain('amanhã às 09:00');
    expect(reply.some((effect) => effect.type === 'setPending' && !effect.pending)).toBe(true);
    expect(find(reply, 'edit')?.messageId).toBe(99);
  });

  it('avisa quando não entende o horário e continua esperando', () => {
    const reply = message('sei lá', { itemId: aop.id, screen: { kind: 'card', context: 'new' } });
    expect(find(reply, 'send')?.text).toContain('Não entendi o horário');
    expect(find(reply, 'setReminder')).toBeUndefined();
  });
});

describe('painel e novidades', () => {
  it('navega pelo menu editando a mesma mensagem', () => {
    const effects = click({ type: 'view', view: 'tasks', refresh: false });
    const edit = find(effects, 'edit');
    expect(edit?.text).toContain('✍️ <b>Atividades</b>');
    expect(edit?.keyboard.flat().map((button) => button.text)).toContain('⬅️ Voltar');
  });

  it('abre o detalhe de uma atividade a partir do painel e volta', () => {
    const effects = click({
      type: 'item',
      itemId: aop.id,
      screen: { kind: 'detail', from: 'tasks' },
    });
    const edit = find(effects, 'edit');
    expect(edit?.text).toContain('🟢 Disponível: 06/10');
    expect(edit?.text).toContain('🔴 Entrega: 13/10 às 23:59 · faltam 11 dias');
    expect(edit?.text).toContain('⭐ Vale: 2 pontos');
    const back = edit?.keyboard.flat().find((button) => button.text === '⬅️ Voltar');
    expect(back && 'callback_data' in back ? back.callback_data : '').toBe('v|tasks|');
  });

  it('pagina as novidades com ⬅️ 1/2 ➡️', () => {
    const first = find(click({ type: 'page', batchId: 'ab12cd34', index: 0 }), 'edit');
    expect(first?.text).toContain('Novidade 1 de 2');
    expect(first?.keyboard.flat().map((button) => button.text)).toEqual(
      expect.arrayContaining(['1/2', '➡️', '📋 Voltar ao resumo', '✅ Concluir']),
    );
    const summary = find(click({ type: 'page', batchId: 'ab12cd34', index: -1 }), 'edit');
    expect(summary?.text).toContain('Encontrei algumas novidades');
  });

  it('responde /painel com o menu e ignora outros chats', () => {
    const effects = message('/painel');
    expect(find(effects, 'send')?.text).toContain('🎓 <b>Sua faculdade</b>');
    const context = createRenderContext({ now, items: [aop] });
    const stranger = handleUpdate(
      { update_id: 3, message: { message_id: 1, chat: { id: 7 }, text: '/painel' } },
      { chatId, context },
      now,
    );
    expect(stranger).toEqual([]);
  });

  it('recusa botões vindos de outro chat', () => {
    const context = createRenderContext({ now, items: [aop] });
    const effects = handleUpdate(
      {
        update_id: 4,
        callback_query: { id: 'c', data: 'x', message: { message_id: 1, chat: { id: 7 } } },
      },
      { chatId, context },
      now,
    );
    expect(effects).toEqual([{ type: 'answer', callbackId: 'c', text: 'Esse botão não é seu.' }]);
  });
});

describe('resposta imediata ao toque', () => {
  const card = { kind: 'card', context: 'new' } as const;

  it('responde na hora o que não depende da planilha, com o mesmo aviso do bot', () => {
    const done: CallbackAction = {
      type: 'status',
      itemId: aop.id,
      status: 'DONE',
      undo: false,
      screen: card,
    };
    const quick = quickAnswer(tap(done), chatId);
    expect(quick).toEqual(find(click(done), 'answer'));
    expect(quickAnswer(tap({ type: 'remindMenu', itemId: aop.id, screen: card }), chatId)).toEqual({
      type: 'answer',
      callbackId: 'callback-1',
      text: 'Quando eu te lembro?',
    });
    expect(quickAnswer(tap({ type: 'view', view: 'exams', refresh: false }), chatId)).toEqual({
      type: 'answer',
      callbackId: 'callback-1',
    });
  });

  it('espera os dados quando o aviso depende deles', () => {
    expect(
      quickAnswer(tap({ type: 'remind', itemId: aop.id, option: '1h', screen: card }), chatId),
    ).toBeUndefined();
    expect(quickAnswer(tap({ type: 'view', view: 'home', refresh: true }), chatId)).toBeUndefined();
    expect(quickAnswer(tap({ type: 'view', view: 'home', refresh: false }), '7')).toBeUndefined();
  });

  it('não responde de novo um toque já respondido', () => {
    const effects = click(
      { type: 'status', itemId: aop.id, status: 'DONE', undo: false, screen: card },
      [aop, prova],
      true,
    );
    expect(find(effects, 'answer')).toBeUndefined();
    expect(find(effects, 'edit')).toBeDefined();
    expect(find(effects, 'setStatus')).toBeDefined();
  });

  it('lista as atividades e lotes que o toque precisa encontrar', () => {
    expect(
      referencedData(
        tap({
          type: 'status',
          itemId: aop.id,
          status: 'DONE',
          undo: false,
          screen: { kind: 'pager', batchId: batch.batchId, index: 1 },
        }),
      ),
    ).toEqual({ itemIds: [aop.id], batchIds: [batch.batchId] });
    expect(referencedData(tap({ type: 'page', batchId: batch.batchId, index: 0 }))).toEqual({
      itemIds: [],
      batchIds: [batch.batchId],
    });
    expect(
      referencedData(
        { update_id: 3, message: { message_id: 5, chat: { id: Number(chatId) }, text: '18:30' } },
        { itemId: prova.id, screen: card },
      ),
    ).toEqual({ itemIds: [prova.id], batchIds: [] });
  });
});

describe('envio de lembretes', () => {
  it('envia só os vencidos, com ações, e marca como enviados', () => {
    const context = createRenderContext({ now, items: [aop, prova] });
    const effects = dueReminders(
      [
        { itemId: aop.id, remindAt: '2026-10-02T14:55:00Z', createdAt: '', chatId },
        { itemId: prova.id, remindAt: '2026-10-02T18:00:00Z', createdAt: '', chatId },
      ],
      context,
      now,
    );
    expect(effects.filter((effect) => effect.type === 'send')).toHaveLength(1);
    expect(find(effects, 'send')?.text).toMatch(/^⏰/);
    expect(find(effects, 'setReminder')?.reminder.sentAt).toBe(now.toISOString());
  });
});
