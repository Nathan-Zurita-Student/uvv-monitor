import type { AcademicItem, ItemStatus } from '../models/academic-item.js';
import type { AcademicRepository } from '../persistence/repository.js';
import { parseTelegramAction } from './commands.js';
import type { TelegramClient } from './client.js';
import { formatPriorityTask } from './format.js';
import { buildTaskInlineKeyboard, parseTaskCallback } from './task-actions.js';
import type { TelegramUpdate } from './types.js';

const statusLabels: Record<ItemStatus, string> = {
  TODO: 'Ainda não comecei',
  IN_PROGRESS: 'Estou fazendo',
  DONE: 'Concluída',
  WAITING: 'Aguardando',
  NEEDS_CONFIRMATION: 'Precisa de confirmação',
  IGNORED: 'Ignorada',
};

const helpMessage = [
  'Olá! Eu acompanho suas informações acadêmicas da UVV.',
  '',
  'Quando uma tarefa precisar da sua atenção, vou explicar o que aconteceu e mostrar botões para você atualizar o andamento. Você não precisa decorar comandos nem copiar códigos.',
  '',
  'Também aceito respostas como “já fiz”, “estou fazendo” e “ainda não comecei” quando você responde diretamente à mensagem de uma tarefa.',
].join('\n');

function confirmation(item: AcademicItem, status: ItemStatus): string {
  const title = item.title.replace(/\s+/g, ' ').trim();
  if (status === 'DONE')
    return `✅ Pronto! Marquei “${title}” como concluída. Ela não aparecerá mais nas suas pendências.`;
  if (status === 'IN_PROGRESS')
    return `🔄 Certo! Marquei “${title}” como em andamento. Vou levar isso em conta nos próximos resumos.`;
  if (status === 'TODO')
    return `⏳ Tudo bem. “${title}” continua como não iniciada e permanecerá nas suas prioridades.`;
  if (status === 'IGNORED')
    return `🙈 Entendido. “${title}” foi ignorada e não aparecerá mais nas suas pendências.`;
  return `Atualizei “${title}” para: ${statusLabels[status]}.`;
}

function messageFrom(update: TelegramUpdate) {
  if (update.message) return update.message;
  return update.callback_query?.message;
}

export async function processTelegramUpdates(
  client: TelegramClient,
  repository: AcademicRepository,
  allowedChatId: string,
  now = new Date().toISOString(),
): Promise<number> {
  const state = await repository.getTelegramState();
  const updates = await client.getUpdates(state.lastUpdateId + 1);
  if (updates.length === 0) return 0;
  const items = await repository.listDetectedItems();
  const byId = new Map(items.map((item) => [item.id.toUpperCase(), item]));
  let lastUpdateId = state.lastUpdateId;
  let processed = 0;

  for (const update of updates.sort((a, b) => a.update_id - b.update_id)) {
    lastUpdateId = Math.max(lastUpdateId, update.update_id);
    const message = messageFrom(update);
    const text = update.message?.text ?? update.callback_query?.data;
    if (!message || String(message.chat.id) !== allowedChatId || !text) continue;

    const taskCallback = update.callback_query ? parseTaskCallback(text) : undefined;
    if (update.callback_query && taskCallback) {
      const item = byId.get(taskCallback.itemId);
      if (!item) {
        await client
          .answerCallbackQuery(update.callback_query.id, 'Essa tarefa não foi encontrada.')
          .catch(() => undefined);
        continue;
      }
      const updated: AcademicItem = { ...item, status: taskCallback.status };
      if (item.status !== taskCallback.status) {
        await repository.upsertDetectedItems([updated]);
        await repository.upsertTaskStatus({
          itemId: item.id,
          status: taskCallback.status,
          updatedAt: now,
          source: 'TELEGRAM',
        });
        byId.set(item.id.toUpperCase(), updated);
      }
      await client.editMessageText(
        String(message.chat.id),
        message.message_id,
        formatPriorityTask(updated),
        buildTaskInlineKeyboard(updated),
      );
      await repository.upsertTelegramTaskMessage({
        itemId: item.id,
        chatId: String(message.chat.id),
        messageId: message.message_id,
        lastRenderedStatus: taskCallback.status,
        updatedAt: now,
      });
      await client
        .answerCallbackQuery(update.callback_query.id, 'Status atualizado.')
        .catch(() => undefined);
      processed += 1;
      continue;
    }
    if (update.callback_query) {
      await client
        .answerCallbackQuery(update.callback_query.id, 'Esse botão não é mais válido.')
        .catch(() => undefined);
    }

    const action = parseTelegramAction(text, message.reply_to_message?.text);
    if (action.kind === 'IGNORE') continue;
    if (action.kind === 'HELP') {
      await client.sendMessage(helpMessage);
      processed += 1;
      continue;
    }
    if (action.kind === 'UNKNOWN') {
      await client.sendMessage(
        `${action.reason}\n\nPara evitar atualizar a tarefa errada, responda diretamente à mensagem dela com “já fiz”, “estou fazendo” ou “ainda não comecei”. Quando houver botões, você também pode apenas tocar em uma opção.`,
      );
      continue;
    }

    const item = byId.get(action.itemId);
    if (!item) {
      await client.sendMessage(
        `Não encontrei a tarefa ${action.itemId}. Ela pode ser antiga ou o código pode estar incompleto. Aguarde o próximo resumo e use os botões mostrados nele.`,
      );
      continue;
    }

    if (action.kind === 'GET_STATUS') {
      await client.sendMessage(
        `📌 ${item.title.replace(/\s+/g, ' ').trim()}\n📊 Seu andamento: ${statusLabels[item.status]}\n🆔 Código: ${item.id}`,
      );
      processed += 1;
      continue;
    }

    if (item.status === action.status) {
      processed += 1;
      continue;
    }

    const updated: AcademicItem = { ...item, status: action.status };
    await repository.upsertDetectedItems([updated]);
    await repository.upsertTaskStatus({
      itemId: item.id,
      status: action.status,
      updatedAt: now,
      source: 'TELEGRAM',
    });
    byId.set(item.id.toUpperCase(), updated);
    await client.sendMessage(confirmation(item, action.status));
    processed += 1;
  }

  await repository.setTelegramState({ lastUpdateId });
  return processed;
}
