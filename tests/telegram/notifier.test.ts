import { describe, expect, it } from 'vitest';
import type { NotificationPlan } from '../../src/bot/notifications.js';
import { createRenderContext } from '../../src/bot/screens.js';
import type { AcademicItem } from '../../src/models/academic-item.js';
import { InMemoryAcademicRepository } from '../../src/persistence/memory.js';
import type { DailySlot } from '../../src/scheduler/windows.js';
import type { TelegramMessageOptions, TelegramSender } from '../../src/telegram/client.js';
import { deliverNotifications } from '../../src/telegram/notifier.js';
import type { TelegramMessage } from '../../src/telegram/types.js';
import { exam, item, now } from '../bot/fixtures.js';

class FakeTelegram implements TelegramSender {
  readonly sent: Array<{ text: string; options: TelegramMessageOptions }> = [];
  readonly pinned: number[] = [];
  readonly unpinned: number[] = [];

  sendMessage(text: string, options: TelegramMessageOptions = {}): Promise<TelegramMessage> {
    this.sent.push({ text, options });
    return Promise.resolve({ message_id: this.sent.length, chat: { id: 1 }, text });
  }

  pinChatMessage(messageId: number): Promise<void> {
    this.pinned.push(messageId);
    return Promise.resolve();
  }

  unpinChatMessage(messageId: number): Promise<void> {
    this.unpinned.push(messageId);
    return Promise.resolve();
  }
}

async function deliver(
  slot: DailySlot,
  items: AcademicItem[],
  plan: NotificationPlan,
  weekly = false,
) {
  const telegram = new FakeTelegram();
  const repository = new InMemoryAcademicRepository();
  repository.telegramState = { lastUpdateId: 7, panelMessageId: 99 };
  const errors = await deliverNotifications({
    telegram,
    repository,
    slot,
    context: createRenderContext({ now, items }),
    plan,
    weekly,
  });
  return { telegram, repository, errors };
}

const emptyPlan: NotificationPlan = { notifications: [], log: [] };

describe('envio das mensagens agendadas', () => {
  const aop = item();
  const prova = exam();

  it('uma novidade vira um cartão curto com botões internos', async () => {
    const { telegram, repository } = await deliver('17:00', [aop], {
      notifications: [{ item: aop, reason: 'new' }],
      log: [{ itemId: aop.id, signature: 's', level: 'none', lastNotifiedAt: now.toISOString() }],
    });
    expect(telegram.sent).toHaveLength(1);
    const [card] = telegram.sent;
    expect(card?.text).toContain('📝 <b>AOP 03 — Aspectos Legais</b>');
    expect(card?.text).not.toContain(aop.id);
    const buttons = card?.options.inlineKeyboard?.flat() ?? [];
    expect(buttons.filter((button) => 'url' in button).map((button) => button.text)).toEqual([
      '📖 Abrir atividade',
    ]);
    expect(
      buttons.some((button) => 'callback_data' in button && button.text === '✅ Concluir'),
    ).toBe(true);
    expect(repository.notificationLog.get(aop.id)?.signature).toBe('s');
  });

  it('várias novidades viram um resumo com "Ver novidades"', async () => {
    const { telegram, repository } = await deliver('17:00', [aop, prova], {
      notifications: [
        { item: aop, reason: 'new' },
        { item: prova, reason: 'urgent' },
      ],
      log: [],
    });
    expect(telegram.sent).toHaveLength(1);
    expect(telegram.sent[0]?.text).toContain('Encontrei algumas novidades');
    const [batch] = repository.batches.values();
    expect(batch?.entries).toEqual([
      { itemId: aop.id, reason: 'new' },
      { itemId: prova.id, reason: 'urgent' },
    ]);
    const button = telegram.sent[0]?.options.inlineKeyboard?.[0]?.[0];
    expect(button && 'callback_data' in button ? button.callback_data : '').toBe(
      `p|${batch?.batchId ?? ''}|0`,
    );
  });

  it('às 12h envia o painel em menu e o fixa no lugar do anterior', async () => {
    const { telegram, repository } = await deliver('12:00', [aop, prova], emptyPlan);
    expect(telegram.sent[0]?.text).toContain('🎓 <b>Sua faculdade</b>');
    expect(telegram.sent[0]?.options.silent).toBe(true);
    expect(telegram.unpinned).toEqual([99]);
    expect(telegram.pinned).toEqual([1]);
    expect(repository.telegramState.panelMessageId).toBe(1);
  });

  it('às 21h só fala de amanhã se houver algo, e no domingo manda a semana', async () => {
    expect((await deliver('21:00', [aop], emptyPlan)).telegram.sent).toHaveLength(0);
    const tomorrow = item({ officialDeadline: '2026-10-03T23:59:00' });
    const { telegram } = await deliver('21:00', [tomorrow], emptyPlan, true);
    expect(telegram.sent.map((message) => message.text.split('\n')[0])).toEqual([
      '🌙 <b>Amanhã</b> · Sábado, 03 de outubro',
      '📅 <b>Próximos 14 dias</b>',
    ]);
  });

  it('com resumo externo não repete painel, mas continua enviando novidades', async () => {
    const telegram = new FakeTelegram();
    const repository = new InMemoryAcademicRepository();
    const errors = await deliverNotifications({
      telegram,
      repository,
      slot: '12:00',
      context: createRenderContext({ now, items: [aop] }),
      plan: { notifications: [{ item: aop, reason: 'new' }], log: [] },
      weekly: false,
      dailyDigestExternal: true,
    });
    expect(errors).toEqual([]);
    expect(telegram.sent).toHaveLength(1);
    expect(telegram.pinned).toEqual([]);
    expect(telegram.sent[0]?.text).toContain('AOP');
  });
});
