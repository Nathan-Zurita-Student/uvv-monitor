import type { ItemStatus } from '../models/academic-item.js';

export type TelegramAction =
  | { kind: 'SET_STATUS'; itemId: string; status: ItemStatus }
  | { kind: 'GET_STATUS'; itemId: string }
  | { kind: 'HELP' }
  | { kind: 'IGNORE' }
  | { kind: 'UNKNOWN'; reason: string };

const idPattern = /\bUVV-[A-Z0-9]{4,10}\b/i;

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function itemIdFrom(text: string, replyText?: string): string | undefined {
  return (text.match(idPattern)?.[0] ?? replyText?.match(idPattern)?.[0])?.toUpperCase();
}

export function parseTelegramAction(text: string, replyText?: string): TelegramAction {
  const normalized = normalize(text);
  const itemId = itemIdFrom(text, replyText);
  const explicit = /^\/(feito|fazendo|pendente|ignorar|status)(?:@\w+)?\b/i.exec(text.trim());

  if (/^\/(start|ajuda)(?:@\w+)?\b/i.test(text.trim())) return { kind: 'HELP' };

  if (explicit) {
    if (!itemId) return { kind: 'UNKNOWN', reason: 'ID da tarefa ausente.' };
    const command = explicit[1]?.toLowerCase();
    if (command === 'status') return { kind: 'GET_STATUS', itemId };
    const statuses: Record<string, ItemStatus> = {
      feito: 'DONE',
      fazendo: 'IN_PROGRESS',
      pendente: 'TODO',
      ignorar: 'IGNORED',
    };
    return { kind: 'SET_STATUS', itemId, status: statuses[command ?? ''] ?? 'TODO' };
  }

  const todoPhrase = /\b(nao comecei|ainda nao fiz|nao fiz)\b/.test(normalized);
  const progressPhrase = /\b(estou fazendo|ja comecei|estou preparando|em andamento)\b/.test(
    normalized,
  );
  const donePhrase = /\b(ja fiz|terminei|concluido|conclui)\b/.test(normalized);
  const ignorePhrase = /\b(ignorar|nao quero acompanhar)\b/.test(normalized);
  if (!todoPhrase && !progressPhrase && !donePhrase && !ignorePhrase) return { kind: 'IGNORE' };
  if (!itemId) return { kind: 'UNKNOWN', reason: 'Não foi possível identificar a tarefa.' };
  if (todoPhrase) {
    return { kind: 'SET_STATUS', itemId, status: 'TODO' };
  }
  if (progressPhrase) {
    return { kind: 'SET_STATUS', itemId, status: 'IN_PROGRESS' };
  }
  if (donePhrase) {
    return { kind: 'SET_STATUS', itemId, status: 'DONE' };
  }
  if (ignorePhrase) {
    return { kind: 'SET_STATUS', itemId, status: 'IGNORED' };
  }
  return { kind: 'IGNORE' };
}
