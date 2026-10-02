import type {
  AcademicItem,
  ItemSource,
  ItemStatus,
  ItemType,
  TelegramTaskMessage,
  Urgency,
  UserTaskStatus,
} from '../models/academic-item.js';
import type { NotificationLogEntry, Reminder, TelegramBatch } from '../models/bot.js';

/**
 * Colunas de cada aba da planilha. Compartilhado entre o monitor (Node) e o bot no Apps Script,
 * por isso este módulo não depende de bibliotecas do Node.
 */
export const tables = {
  detected_items: [
    'id',
    'externalId',
    'source',
    'sourceUrl',
    'discipline',
    'title',
    'description',
    'type',
    'officialDate',
    'officialDeadline',
    'firstSeenAt',
    'lastSeenAt',
    'contentHash',
    'previousHash',
    'calendarEventId',
    'status',
    'urgency',
    'metadata',
  ],
  user_task_status: [
    'itemId',
    'status',
    'updatedAt',
    'source',
    'previousStatus',
    'completedAt',
    'ignoredAt',
  ],
  run_history: [
    'runId',
    'startedAt',
    'finishedAt',
    'portalStatus',
    'gmailStatus',
    'calendarStatus',
    'itemsFound',
    'errors',
  ],
  telegram_state: ['lastUpdateId', 'panelMessageId'],
  telegram_task_messages: [
    'itemId',
    'chatId',
    'messageId',
    'lastRenderedStatus',
    'updatedAt',
    'actionToken',
    'renderedText',
  ],
  reminders: ['itemId', 'remindAt', 'createdAt', 'sentAt', 'chatId'],
  notification_log: ['itemId', 'signature', 'level', 'lastNotifiedAt'],
  telegram_batches: ['batchId', 'createdAt', 'entries'],
} as const;

export type TableName = keyof typeof tables;

function parseJsonRecord(value: string | undefined): Record<string, string> | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  } catch {
    return undefined;
  }
}

export function academicItemToRow(item: AcademicItem): string[] {
  return [
    item.id,
    item.externalId,
    item.source,
    item.sourceUrl,
    item.discipline ?? '',
    item.title,
    item.description,
    item.type,
    item.officialDate ?? '',
    item.officialDeadline ?? '',
    item.firstSeenAt,
    item.lastSeenAt,
    item.contentHash,
    item.previousHash ?? '',
    item.calendarEventId ?? '',
    item.status,
    item.urgency,
    JSON.stringify(item.metadata ?? {}),
  ];
}

export function academicItemFromRow(row: string[]): AcademicItem {
  const metadata = parseJsonRecord(row[17]);
  return {
    id: row[0] ?? '',
    externalId: row[1] ?? '',
    source: (row[2] ?? 'PORTAL') as ItemSource,
    sourceUrl: row[3] ?? '',
    ...(row[4] ? { discipline: row[4] } : {}),
    title: row[5] ?? '',
    description: row[6] ?? '',
    type: (row[7] ?? 'NOTICE') as ItemType,
    ...(row[8] ? { officialDate: row[8] } : {}),
    ...(row[9] ? { officialDeadline: row[9] } : {}),
    firstSeenAt: row[10] ?? '',
    lastSeenAt: row[11] ?? '',
    contentHash: row[12] ?? '',
    ...(row[13] ? { previousHash: row[13] } : {}),
    ...(row[14] ? { calendarEventId: row[14] } : {}),
    status: (row[15] || 'TODO') as ItemStatus,
    urgency: (row[16] || 'INFORMATIONAL') as Urgency,
    ...(metadata ? { metadata } : {}),
  };
}

export function userStatusToRow(status: UserTaskStatus): string[] {
  return [
    status.itemId,
    status.status,
    status.updatedAt,
    status.source,
    status.previousStatus ?? '',
    status.completedAt ?? '',
    status.ignoredAt ?? '',
  ];
}

export function userStatusFromRow(row: string[]): UserTaskStatus {
  return {
    itemId: row[0] ?? '',
    status: (row[1] || 'TODO') as ItemStatus,
    updatedAt: row[2] ?? '',
    source: (row[3] || 'SYSTEM') as UserTaskStatus['source'],
    ...(row[4] ? { previousStatus: row[4] as ItemStatus } : {}),
    ...(row[5] ? { completedAt: row[5] } : {}),
    ...(row[6] ? { ignoredAt: row[6] } : {}),
  };
}

export function telegramTaskMessageToRow(message: TelegramTaskMessage): string[] {
  return [
    message.itemId,
    message.chatId,
    String(message.messageId),
    message.lastRenderedStatus,
    message.updatedAt,
    message.actionToken ?? '',
    message.renderedText ?? '',
  ];
}

export function telegramTaskMessageFromRow(row: string[]): TelegramTaskMessage {
  return {
    itemId: row[0] ?? '',
    chatId: row[1] ?? '',
    messageId: Number(row[2] ?? 0),
    lastRenderedStatus: (row[3] || 'TODO') as ItemStatus,
    updatedAt: row[4] ?? '',
    ...(row[5] ? { actionToken: row[5] } : {}),
    ...(row[6] ? { renderedText: row[6] } : {}),
  };
}

export function reminderToRow(reminder: Reminder): string[] {
  return [
    reminder.itemId,
    reminder.remindAt,
    reminder.createdAt,
    reminder.sentAt ?? '',
    reminder.chatId,
  ];
}

export function reminderFromRow(row: string[]): Reminder {
  return {
    itemId: row[0] ?? '',
    remindAt: row[1] ?? '',
    createdAt: row[2] ?? '',
    ...(row[3] ? { sentAt: row[3] } : {}),
    chatId: row[4] ?? '',
  };
}

export function notificationLogToRow(entry: NotificationLogEntry): string[] {
  return [entry.itemId, entry.signature, entry.level, entry.lastNotifiedAt];
}

export function notificationLogFromRow(row: string[]): NotificationLogEntry {
  return {
    itemId: row[0] ?? '',
    signature: row[1] ?? '',
    level: (row[2] || 'none') as NotificationLogEntry['level'],
    lastNotifiedAt: row[3] ?? '',
  };
}

export function batchToRow(batch: TelegramBatch): string[] {
  return [batch.batchId, batch.createdAt, JSON.stringify(batch.entries)];
}

export function batchFromRow(row: string[]): TelegramBatch {
  let entries: TelegramBatch['entries'] = [];
  try {
    const parsed: unknown = JSON.parse(row[2] ?? '[]');
    if (Array.isArray(parsed)) {
      entries = parsed.filter(
        (entry): entry is TelegramBatch['entries'][number] =>
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as { itemId?: unknown }).itemId === 'string' &&
          typeof (entry as { reason?: unknown }).reason === 'string',
      );
    }
  } catch {
    entries = [];
  }
  return { batchId: row[0] ?? '', createdAt: row[1] ?? '', entries };
}
