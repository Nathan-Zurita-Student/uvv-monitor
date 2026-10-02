import type { AcademicItem, TelegramTaskMessage, UserTaskStatus } from '../models/academic-item.js';
import type { NotificationLogEntry, Reminder, TelegramBatch } from '../models/bot.js';
import type { RunHistory, TelegramState } from '../models/run.js';

export interface AcademicRepository {
  initialize(): Promise<void>;
  listDetectedItems(): Promise<AcademicItem[]>;
  upsertDetectedItems(items: AcademicItem[]): Promise<void>;
  listTaskStatuses(): Promise<UserTaskStatus[]>;
  upsertTaskStatus(status: UserTaskStatus): Promise<void>;
  listTelegramTaskMessages(): Promise<TelegramTaskMessage[]>;
  upsertTelegramTaskMessage(message: TelegramTaskMessage): Promise<void>;
  listReminders(): Promise<Reminder[]>;
  upsertReminder(reminder: Reminder): Promise<void>;
  listNotificationLog(): Promise<NotificationLogEntry[]>;
  upsertNotificationLog(entries: NotificationLogEntry[]): Promise<void>;
  listBatches(): Promise<TelegramBatch[]>;
  insertBatch(batch: TelegramBatch): Promise<void>;
  appendRunHistory(run: RunHistory): Promise<void>;
  getTelegramState(): Promise<TelegramState>;
  setTelegramState(state: TelegramState): Promise<void>;
}
