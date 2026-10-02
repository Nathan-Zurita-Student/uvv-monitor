import { handleUpdate, type BotEffect } from '../bot/core.js';
import { createRenderContext } from '../bot/screens.js';
import { applyUserStatuses } from '../bot/status.js';
import type { AcademicRepository } from '../persistence/repository.js';
import type { TelegramClient } from './client.js';

/** Executa os efeitos do núcleo do bot usando o cliente Node (modo sem webhook). */
export async function applyBotEffects(
  effects: BotEffect[],
  client: TelegramClient,
  repository: AcademicRepository,
  chatId: string,
): Promise<void> {
  for (const effect of effects) {
    switch (effect.type) {
      case 'answer':
        await client.answerCallbackQuery(effect.callbackId, effect.text).catch(() => undefined);
        break;
      case 'edit':
        await client
          .editMessageText(chatId, effect.messageId, effect.text, effect.keyboard)
          .catch((error: unknown) => {
            if (!/message is not modified/i.test(String(error))) throw error;
          });
        break;
      case 'editKeyboard':
        await client.editMessageReplyMarkup(chatId, effect.messageId, effect.keyboard);
        break;
      case 'send':
        await client.sendMessage(effect.text, {
          ...(effect.keyboard ? { inlineKeyboard: effect.keyboard } : {}),
          ...(effect.forceReply ? { forceReply: true } : {}),
        });
        break;
      case 'setStatus':
        await repository.upsertTaskStatus(effect.record);
        break;
      case 'setReminder':
        await repository.upsertReminder(effect.reminder);
        break;
      case 'setPending':
        // Resposta livre de horário só é suportada pelo webhook (resposta imediata).
        break;
    }
  }
}

/**
 * Modo sem webhook: lê os cliques e comandos acumulados desde a última execução. O webhook do
 * Apps Script é o modo recomendado, porque responde na hora.
 */
export async function processTelegramUpdates(
  client: TelegramClient,
  repository: AcademicRepository,
  allowedChatId: string,
  now = new Date(),
): Promise<number> {
  const state = await repository.getTelegramState();
  const updates = await client.getUpdates(state.lastUpdateId + 1);
  if (updates.length === 0) return 0;
  const items = applyUserStatuses(
    await repository.listDetectedItems(),
    await repository.listTaskStatuses(),
  );
  const context = createRenderContext({
    now,
    items,
    reminders: await repository.listReminders(),
    batches: await repository.listBatches(),
  });
  let lastUpdateId = state.lastUpdateId;
  let processed = 0;
  for (const update of updates.sort((left, right) => left.update_id - right.update_id)) {
    lastUpdateId = Math.max(lastUpdateId, update.update_id);
    const effects = handleUpdate(update, { chatId: allowedChatId, context }, now);
    if (effects.length === 0) continue;
    await applyBotEffects(effects, client, repository, allowedChatId);
    processed += 1;
  }
  await repository.setTelegramState({ ...state, lastUpdateId });
  return processed;
}
