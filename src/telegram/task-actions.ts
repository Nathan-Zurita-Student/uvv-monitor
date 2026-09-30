import type { AcademicItem, ItemStatus, ItemType } from '../models/academic-item.js';
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

const trackableTypes = new Set<ItemType>([
  'EXAM',
  'ASSIGNMENT',
  'AOP',
  'ACTIVITY',
  'DOCUMENT',
  'SERVICE_REQUEST',
]);

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

export function isTrackableTask(item: AcademicItem): boolean {
  return (
    trackableTypes.has(item.type) &&
    !['DONE', 'IGNORED'].includes(item.status) &&
    item.metadata?.contextOnly !== 'true'
  );
}

function buttonText(label: string, status: ItemStatus, selected: ItemStatus): string {
  return status === selected ? `${label} ✓` : label;
}

export function buildTaskInlineKeyboard(item: AcademicItem): TelegramButton[][] {
  const buttons: TelegramButton[][] = [
    [
      {
        text: buttonText('⏳ Não comecei', 'TODO', item.status),
        callback_data: taskCallbackData(item.id, 'not_started'),
      },
      {
        text: buttonText('🔄 Em andamento', 'IN_PROGRESS', item.status),
        callback_data: taskCallbackData(item.id, 'in_progress'),
      },
    ],
    [
      {
        text: buttonText('✅ Concluído', 'DONE', item.status),
        callback_data: taskCallbackData(item.id, 'completed'),
      },
      {
        text: buttonText('⏸️ Aguardando', 'WAITING', item.status),
        callback_data: taskCallbackData(item.id, 'waiting'),
      },
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
