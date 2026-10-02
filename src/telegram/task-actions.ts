import type { AcademicItem, ItemStatus } from '../models/academic-item.js';
import type { TelegramButton } from './client.js';

export const taskCallbackStatuses = {
  not_started: 'TODO',
  in_progress: 'IN_PROGRESS',
  completed: 'DONE',
  waiting: 'WAITING',
} as const satisfies Record<string, ItemStatus>;

export type TaskCallbackStatus = keyof typeof taskCallbackStatuses;

const callbackKeysByStatus: Partial<Record<ItemStatus, TaskCallbackStatus>> = {
  TODO: 'not_started',
  IN_PROGRESS: 'in_progress',
  DONE: 'completed',
  WAITING: 'waiting',
};

export interface ParsedTaskCallback {
  itemId: string;
  status: ItemStatus;
  callbackStatus: TaskCallbackStatus;
}

export function taskCallbackData(itemId: string, status: TaskCallbackStatus): string {
  const value = `task:${itemId.toUpperCase()}:${status}`;
  if (Buffer.byteLength(value, 'utf8') > 64) {
    throw new Error('Callback da tarefa excede o limite de 64 bytes do Telegram.');
  }
  return value;
}

export function parseTaskCallback(value: string): ParsedTaskCallback | undefined {
  const match = /^task:(UVV-[A-Z0-9]{4,10}):(not_started|in_progress|completed|waiting)$/i.exec(
    value.trim(),
  );
  if (!match?.[1] || !match[2]) return undefined;
  const callbackStatus = match[2].toLowerCase() as TaskCallbackStatus;
  return {
    itemId: match[1].toUpperCase(),
    status: taskCallbackStatuses[callbackStatus],
    callbackStatus,
  };
}

function buttonText(label: string, status: ItemStatus, selected: ItemStatus): string {
  return status === selected ? `${label} ✓` : label;
}

export interface TaskKeyboardOptions {
  actionBaseUrl?: string;
  actionToken?: string;
}

function taskActionUrl(
  baseUrl: string,
  itemId: string,
  status: TaskCallbackStatus,
  token: string,
): string {
  const url = new URL(baseUrl);
  url.searchParams.set('item', itemId);
  url.searchParams.set('status', status);
  url.searchParams.set('token', token);
  return url.toString();
}

export function buildTaskInlineKeyboard(
  item: AcademicItem,
  options: TaskKeyboardOptions = {},
): TelegramButton[][] {
  const actionButton = (text: string, status: TaskCallbackStatus): TelegramButton =>
    options.actionBaseUrl && options.actionToken
      ? {
          text,
          url: taskActionUrl(options.actionBaseUrl, item.id, status, options.actionToken),
        }
      : { text, callback_data: taskCallbackData(item.id, status) };
  const buttons: TelegramButton[][] = [
    [
      actionButton(buttonText('⏳ Não comecei', 'TODO', item.status), 'not_started'),
      actionButton(buttonText('🔄 Em andamento', 'IN_PROGRESS', item.status), 'in_progress'),
    ],
    [
      actionButton(buttonText('✅ Concluído', 'DONE', item.status), 'completed'),
      actionButton(buttonText('⏸️ Aguardando', 'WAITING', item.status), 'waiting'),
    ],
  ];
  if (/^https:\/\//i.test(item.sourceUrl)) {
    buttons.push([
      {
        text: item.source === 'PORTAL' ? '🔗 Abrir no Portal UVV' : '🔗 Abrir informação',
        url: item.sourceUrl,
      },
    ]);
  }
  return buttons;
}

export function callbackKeyForStatus(status: ItemStatus): TaskCallbackStatus | undefined {
  return callbackKeysByStatus[status];
}
