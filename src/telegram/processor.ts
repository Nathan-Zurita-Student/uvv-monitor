import type { AcademicItem, ItemStatus } from '../models/academic-item.js';
import type { AcademicRepository } from '../persistence/repository.js';
import { parseTelegramAction } from './commands.js';
import type { TelegramClient } from './client.js';
import type { TelegramUpdate } from './types.js';

const statusLabels: Record<ItemStatus, string> = {
  TODO: 'NÃO INICIADO',
  IN_PROGRESS: 'EM ANDAMENTO',
  DONE: 'CONCLUÍDO',
  WAITING: 'AGUARDANDO',
  NEEDS_CONFIRMATION: 'PRECISA DE CONFIRMAÇÃO',
  IGNORED: 'IGNORADO',
};

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

    const action = parseTelegramAction(text, message.reply_to_message?.text);
    if (action.kind === 'IGNORE') continue;
    if (action.kind === 'UNKNOWN') {
      await client.sendMessage(
        `${action.reason} Use /feito UVV-XXXXXX, /fazendo UVV-XXXXXX, /pendente UVV-XXXXXX, /ignorar UVV-XXXXXX ou /status UVV-XXXXXX.`,
      );
      continue;
    }

    const item = byId.get(action.itemId);
    if (!item) {
      await client.sendMessage(`Não encontrei a tarefa ${action.itemId}.`);
      continue;
    }

    if (action.kind === 'GET_STATUS') {
      await client.sendMessage(`${item.id} — ${item.title}\nStatus: ${statusLabels[item.status]}`);
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
    await client.sendMessage(`${item.id} atualizado para ${statusLabels[action.status]}.`);
    processed += 1;
  }

  await repository.setTelegramState({ lastUpdateId });
  return processed;
}
