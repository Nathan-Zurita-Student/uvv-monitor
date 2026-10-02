import { describe, expect, it } from 'vitest';
import { buildAgenda } from '../../src/agenda/agenda.js';
import type { AiProvider } from '../../src/ai/types.js';
import type { AcademicItem } from '../../src/models/academic-item.js';
import { InMemoryAcademicRepository } from '../../src/persistence/memory.js';
import type { DailySlot } from '../../src/scheduler/windows.js';
import type { TelegramMessageOptions, TelegramSender } from '../../src/telegram/client.js';
import { deliverNotifications, type Novelty } from '../../src/telegram/notifier.js';
import type { TelegramMessage } from '../../src/telegram/types.js';

const now = new Date('2026-10-02T15:00:00Z');

class FakeTelegram implements TelegramSender {
  readonly sent: Array<{ text: string; options: TelegramMessageOptions }> = [];
  readonly pinned: number[] = [];
  readonly unpinned: number[] = [];

  sendMessage(text: string, options: TelegramMessageOptions = {}): Promise<TelegramMessage> {
    this.sent.push({ text, options });
    return Promise.resolve({
      message_id: this.sent.length,
      chat: { id: 1 },
      text,
    } as TelegramMessage);
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

let sequence = 0;
type Overrides = { [K in keyof AcademicItem]?: AcademicItem[K] | undefined };

function item(overrides: Overrides = {}): AcademicItem {
  sequence += 1;
  const merged = {
    id: `UVV-${String(sequence).padStart(6, '0')}`,
    externalId: String(sequence),
    source: 'PORTAL',
    sourceUrl: 'https://aluno.uvv.br',
    discipline: 'Cálculo Numérico',
    title: 'Lista 3',
    description: 'Resolver a lista',
    type: 'ASSIGNMENT',
    officialDeadline: '2026-10-03T23:59:00',
    firstSeenAt: '2026-10-01T12:00:00Z',
    lastSeenAt: '2026-10-01T12:00:00Z',
    contentHash: 'hash',
    status: 'TODO',
    urgency: 'NEXT_24_HOURS',
    ...overrides,
  };
  // Remove campos sobrescritos com undefined (exactOptionalPropertyTypes).
  return Object.fromEntries(
    Object.entries(merged).filter(([, value]) => value !== undefined),
  ) as unknown as AcademicItem;
}

async function deliver(
  slot: DailySlot,
  items: AcademicItem[],
  novelties: Novelty[] = [],
  extra: { aiProvider?: AiProvider; weekly?: boolean } = {},
) {
  const telegram = new FakeTelegram();
  const repository = new InMemoryAcademicRepository();
  repository.telegramState = { lastUpdateId: 7, panelMessageId: 99 };
  const errors = await deliverNotifications({
    telegram,
    repository,
    chatId: '1',
    slot,
    agenda: buildAgenda(items, now),
    novelties,
    weekly: extra.weekly ?? false,
    actionBaseUrl: 'https://script.google.com/macros/s/abc/exec',
    ...(extra.aiProvider ? { aiProvider: extra.aiProvider } : {}),
  });
  return { telegram, repository, errors };
}

describe('notificações por horário', () => {
  it('envia o painel às 12h e o mantém fixado no chat', async () => {
    const { telegram, repository, errors } = await deliver('12:00', [item()]);
    expect(errors).toEqual([]);
    expect(telegram.sent).toHaveLength(1);
    expect(telegram.sent[0]?.text).toContain('PAINEL ACADÊMICO');
    expect(telegram.unpinned).toEqual([99]);
    expect(telegram.pinned).toEqual([1]);
    expect(repository.telegramState).toEqual({ lastUpdateId: 7, panelMessageId: 1 });
  });

  it('às 17h só fala se algo vence hoje', async () => {
    expect((await deliver('17:00', [item()])).telegram.sent).toHaveLength(0);
    const { telegram } = await deliver('17:00', [
      item({ officialDeadline: '2026-10-02T23:59:00' }),
    ]);
    expect(telegram.sent[0]?.text).toContain('AINDA HOJE');
  });

  it('às 21h prepara o dia seguinte e pergunta o andamento do que está perto', async () => {
    const generateJson = () => Promise.reject(new Error('cota'));
    const { telegram } = await deliver('21:00', [item()], [], {
      aiProvider: { name: 'fake', generateJson },
      weekly: true,
    });
    const texts = telegram.sent.map((message) => message.text);
    expect(texts[0]).toContain('🌙 <b>AMANHÃ</b>');
    expect(texts[0]).toContain('🎯 <b>Foco sugerido</b>');
    expect(texts[0]).toContain('Finalizar e entregar');
    expect(texts[1]).toContain('COMO ESTÁ ESSA ENTREGA?');
    expect(telegram.sent[1]?.options.inlineKeyboard).toBeDefined();
    expect(texts[2]).toContain('SUA SEMANA');
  });

  it('usa o foco sugerido pela IA quando disponível', async () => {
    const task = item();
    const generateJson = () =>
      Promise.resolve({ focus: [{ itemId: task.id, action: 'Fazer os exercícios 4 a 6' }] });
    const { telegram } = await deliver('21:00', [task], [], {
      aiProvider: { name: 'fake', generateJson },
    });
    expect(telegram.sent[0]?.text).toContain('Fazer os exercícios 4 a 6');
  });
});

describe('novidades', () => {
  it('envia cartão com botões para provas e entregas e guarda o modelo da mensagem', async () => {
    const task = item();
    const { telegram, repository } = await deliver(
      '17:00',
      [task],
      [{ item: task, isNew: true, changes: [] }],
    );
    expect(telegram.sent[0]?.text).toContain('🆕 <b>NOVA ENTREGA</b>');
    expect(telegram.sent[0]?.text).toContain('⏳ Não iniciado');
    const stored = repository.telegramTaskMessages.get(task.id);
    expect(stored?.renderedText).toContain('{{STATUS}}');
    expect(stored?.actionToken).toHaveLength(36);
  });

  it('agrupa avisos e ignora o que a IA considerou irrelevante', async () => {
    const notice = item({ type: 'NOTICE', title: 'Aula cancelada', officialDeadline: undefined });
    const spam = item({
      type: 'NOTICE',
      title: 'Vaga de estágio',
      source: 'GMAIL',
      metadata: { aiRelevance: 'IRRELEVANT' },
    });
    const { telegram } = await deliver(
      '17:00',
      [notice, spam],
      [
        { item: notice, isNew: true, changes: [] },
        { item: spam, isNew: true, changes: [] },
      ],
    );
    expect(telegram.sent).toHaveLength(1);
    expect(telegram.sent[0]?.text).toContain('OUTROS AVISOS');
    expect(telegram.sent[0]?.text).toContain('Aula cancelada');
    expect(telegram.sent[0]?.text).not.toContain('Vaga de estágio');
  });

  it('diferencia prazo definido pela primeira vez de prazo alterado', async () => {
    const task = item();
    const definido = await deliver(
      '17:00',
      [task],
      [
        {
          item: task,
          isNew: false,
          changes: [{ field: 'officialDeadline', after: '2026-10-03T23:59:00' }],
        },
      ],
    );
    expect(definido.telegram.sent[0]?.text).toContain('📅 <b>PRAZO DEFINIDO</b>');
    const alterado = await deliver(
      '17:00',
      [task],
      [
        {
          item: task,
          isNew: false,
          changes: [
            {
              field: 'officialDeadline',
              before: '2026-10-01T23:59:00',
              after: '2026-10-03T23:59:00',
            },
          ],
        },
      ],
    );
    expect(alterado.telegram.sent[0]?.text).toContain('📅 <b>DATA ALTERADA</b>');
  });

  it('não alerta sobre prova que já aconteceu', async () => {
    const past = item({
      type: 'EXAM',
      officialDeadline: undefined,
      officialDate: '2026-09-28',
    });
    const { telegram } = await deliver('17:00', [past], [{ item: past, isNew: true, changes: [] }]);
    expect(telegram.sent).toHaveLength(0);
  });

  it('não repete a pergunta de andamento para quem acabou de receber cartão', async () => {
    const task = item();
    const { telegram } = await deliver('21:00', [task], [{ item: task, isNew: true, changes: [] }]);
    const cards = telegram.sent.filter((message) => message.text.includes(task.id));
    expect(cards).toHaveLength(1);
  });
});
