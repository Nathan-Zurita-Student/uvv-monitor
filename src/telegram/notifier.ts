import { randomUUID } from 'node:crypto';
import { upcoming } from '../agenda/agenda.js';
import type { CardContext } from '../bot/callbacks.js';
import type { NotificationPlan, PendingNotification } from '../bot/notifications.js';
import {
  entryFor,
  renderItemScreen,
  renderNoticeText,
  renderSummary,
  type RenderContext,
} from '../bot/screens.js';
import { renderView } from '../bot/views.js';
import type { NotificationReason, TelegramBatch } from '../models/bot.js';
import type { AcademicRepository } from '../persistence/repository.js';
import type { DailySlot } from '../scheduler/windows.js';
import { logger } from '../utils/logger.js';
import type { TelegramSender } from './client.js';

export interface NotificationInput {
  telegram: TelegramSender;
  repository: AcademicRepository;
  slot: DailySlot;
  context: RenderContext;
  plan: NotificationPlan;
  weekly: boolean;
  /** Resumos periódicos enviados pelo Apps Script, independentemente desta coleta. */
  dailyDigestExternal?: boolean;
}

const cardContexts: Record<Exclude<NotificationReason, 'notice'>, CardContext> = {
  new: 'new',
  date: 'date',
  changed: 'changed',
  urgent: 'urgent',
};

async function sendSingle(
  input: NotificationInput,
  notification: PendingNotification,
): Promise<void> {
  const { item, reason } = notification;
  const entry = notification.entry ?? entryFor(input.context, item);
  if (reason === 'notice' || !entry) {
    const open = /^https:\/\//i.test(item.sourceUrl)
      ? [[{ text: '📖 Abrir', url: item.sourceUrl }]]
      : [];
    await input.telegram.sendMessage(renderNoticeText(item), { inlineKeyboard: open });
    return;
  }
  const rendered = renderItemScreen(
    input.context,
    item,
    { kind: 'card', context: cardContexts[reason] },
    notification.previousDue ? { previousDue: notification.previousDue } : {},
  );
  await input.telegram.sendMessage(rendered.text, { inlineKeyboard: rendered.keyboard });
}

/** Várias novidades viram um resumo com "Ver novidades" em vez de várias mensagens. */
async function sendSummary(input: NotificationInput): Promise<void> {
  const batch: TelegramBatch = {
    batchId: randomUUID().replace(/-/g, '').slice(0, 8),
    createdAt: input.context.now.toISOString(),
    entries: input.plan.notifications.map(({ item, reason }) => ({ itemId: item.id, reason })),
  };
  await input.repository.insertBatch(batch);
  const rendered = renderSummary(input.context, batch);
  await input.telegram.sendMessage(rendered.text, { inlineKeyboard: rendered.keyboard });
}

async function sendPanel(input: NotificationInput): Promise<void> {
  const home = renderView(input.context, 'home');
  const panel = await input.telegram.sendMessage(home.text, {
    inlineKeyboard: home.keyboard,
    silent: true,
  });
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

  const { notifications } = input.plan;
  if (notifications.length > 0) {
    await attempt('novidades', async () => {
      const [first] = notifications;
      if (notifications.length === 1 && first) await sendSingle(input, first);
      else await sendSummary(input);
    });
  }
  // O registro só avança se a novidade foi enviada; senão ela é tentada de novo depois.
  if (errors.length === 0) {
    await attempt('registro', () => input.repository.upsertNotificationLog(input.plan.log));
  }

  if (input.dailyDigestExternal) return errors;
  if (input.slot === '12:00') await attempt('painel', () => sendPanel(input));

  if (input.slot === '20:00') {
    const relevant = upcoming(input.context.agenda, 1).filter(
      (entry) => entry.days === 1 || entry.kind === 'TASK',
    );
    if (relevant.length > 0) {
      await attempt('amanhã', async () => {
        const view = renderView(input.context, 'tomorrow');
        await input.telegram.sendMessage(view.text, { inlineKeyboard: view.keyboard });
      });
    }
    if (input.weekly) {
      await attempt('semana', async () => {
        const view = renderView(input.context, 'cal');
        await input.telegram.sendMessage(view.text, { inlineKeyboard: view.keyboard });
      });
    }
  }
  return errors;
}
