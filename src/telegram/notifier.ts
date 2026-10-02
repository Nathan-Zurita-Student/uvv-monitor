import { randomUUID } from 'node:crypto';
import {
  findEntry,
  selectCheckins,
  toAgendaEntry,
  type Agenda,
  type AgendaEntry,
} from '../agenda/agenda.js';
import { focusKind, isAiIrrelevant, isOpen } from '../agenda/focus.js';
import { defaultTomorrowFocus, suggestTomorrowFocus, type FocusSuggestion } from '../ai/planner.js';
import type { AiProvider } from '../ai/types.js';
import type { AcademicItem } from '../models/academic-item.js';
import type { ItemChange } from '../persistence/deduplication.js';
import type { AcademicRepository } from '../persistence/repository.js';
import type { DailySlot } from '../scheduler/windows.js';
import { logger } from '../utils/logger.js';
import type { TelegramSender } from './client.js';
import {
  formatDueToday,
  formatItemCard,
  formatOtherNews,
  formatPanel,
  formatTomorrow,
  formatWeek,
  renderStatus,
  type CardKind,
} from './format.js';
import { buildTaskInlineKeyboard } from './task-actions.js';

export interface Novelty {
  item: AcademicItem;
  isNew: boolean;
  changes: ItemChange[];
}

export interface NotificationInput {
  telegram: TelegramSender;
  repository: AcademicRepository;
  chatId: string;
  slot: DailySlot;
  agenda: Agenda;
  novelties: Novelty[];
  weekly: boolean;
  actionBaseUrl?: string;
  aiProvider?: AiProvider;
}

/** Cartões individuais por execução; o excedente segue no painel e no resumo de avisos. */
const maxNoveltyCards = 6;

function cardKind(novelty: Novelty): CardKind {
  if (novelty.isNew) return 'NEW';
  const dateChanged = novelty.changes.some(
    (change) => change.field === 'officialDeadline' || change.field === 'officialDate',
  );
  return dateChanged ? 'DATE_CHANGED' : 'UPDATED';
}

async function sendTaskCard(
  input: NotificationInput,
  entry: AgendaEntry,
  kind: CardKind,
  changes: ItemChange[] = [],
): Promise<void> {
  const template = formatItemCard(entry, kind, changes);
  const actionToken = randomUUID();
  const message = await input.telegram.sendMessage(renderStatus(template, entry.item.status), {
    inlineKeyboard: buildTaskInlineKeyboard(
      entry.item,
      input.actionBaseUrl ? { actionBaseUrl: input.actionBaseUrl, actionToken } : {},
    ),
  });
  await input.repository.upsertTelegramTaskMessage({
    itemId: entry.item.id,
    chatId: input.chatId,
    messageId: message.message_id,
    lastRenderedStatus: entry.item.status,
    updatedAt: input.agenda.now.toISOString(),
    actionToken,
    renderedText: template,
  });
}

/** Separa novidades em cartões (provas/entregas relevantes) e avisos para o resumo. */
export function splitNovelties(
  agenda: Agenda,
  novelties: Novelty[],
): { cards: Array<{ entry: AgendaEntry; novelty: Novelty }>; others: AcademicItem[] } {
  const cards: Array<{ entry: AgendaEntry; novelty: Novelty }> = [];
  const others: AcademicItem[] = [];
  for (const novelty of novelties) {
    const { item } = novelty;
    if (!isOpen(item) || isAiIrrelevant(item)) continue;
    if (focusKind(item)) {
      // Fora da agenda = prova que já passou ou entrega antiga: não vale alerta.
      const entry = findEntry(agenda, item.id) ? toAgendaEntry(item, agenda.now) : undefined;
      if (entry) cards.push({ entry, novelty });
      continue;
    }
    others.push(item);
  }
  return { cards, others };
}

async function sendPanel(input: NotificationInput): Promise<void> {
  const [first, ...rest] = formatPanel(input.agenda);
  if (!first) return;
  const panel = await input.telegram.sendMessage(first, { silent: true });
  for (const chunk of rest) await input.telegram.sendMessage(chunk, { silent: true });
  const state = await input.repository.getTelegramState();
  if (state.panelMessageId) {
    await input.telegram.unpinChatMessage(state.panelMessageId).catch(() => undefined);
  }
  try {
    await input.telegram.pinChatMessage(panel.message_id);
  } catch (error) {
    logger.warn({ module: 'Telegram', err: error }, 'Não foi possível fixar o painel');
  }
  await input.repository.setTelegramState({ ...state, panelMessageId: panel.message_id });
}

async function tomorrowFocus(input: NotificationInput): Promise<FocusSuggestion[]> {
  if (input.aiProvider) {
    try {
      const suggestions = await suggestTomorrowFocus(input.aiProvider, input.agenda);
      if (suggestions.length > 0) return suggestions;
    } catch (error) {
      logger.warn({ module: 'AI', err: error }, 'Foco de amanhã gerado sem IA');
    }
  }
  return defaultTomorrowFocus(input.agenda);
}

/** Envia as mensagens da execução e devolve os erros sem interromper as demais etapas. */
export async function deliverNotifications(input: NotificationInput): Promise<string[]> {
  const errors: string[] = [];
  const attempt = async (label: string, step: () => Promise<void>) => {
    try {
      await step();
    } catch (error) {
      errors.push(`Telegram ${label}: ${error instanceof Error ? error.message : 'erro'}`);
    }
  };

  const { cards, others } = splitNovelties(input.agenda, input.novelties);
  const carded = new Set<string>();
  for (const { entry, novelty } of cards.slice(0, maxNoveltyCards)) {
    await attempt('novidade', async () => {
      await sendTaskCard(input, entry, cardKind(novelty), novelty.changes);
      carded.add(entry.item.id);
    });
  }
  if (others.length > 0) {
    await attempt('avisos', async () => {
      for (const chunk of formatOtherNews(others)) await input.telegram.sendMessage(chunk);
    });
  }

  if (input.slot === '12:00') await attempt('painel', () => sendPanel(input));

  if (input.slot === '17:00') {
    const today = formatDueToday(input.agenda);
    if (today)
      await attempt('lembrete', async () => void (await input.telegram.sendMessage(today)));
  }

  if (input.slot === '21:00') {
    await attempt('amanhã', async () => {
      await input.telegram.sendMessage(formatTomorrow(input.agenda, await tomorrowFocus(input)));
    });
    for (const entry of selectCheckins(input.agenda, carded)) {
      await attempt('andamento', () => sendTaskCard(input, entry, 'CHECKIN'));
    }
    if (input.weekly) {
      await attempt(
        'semana',
        async () => void (await input.telegram.sendMessage(formatWeek(input.agenda))),
      );
    }
  }
  return errors;
}
