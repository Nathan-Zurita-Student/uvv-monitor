import type { AcademicItem, TelegramTaskMessage, UserTaskStatus } from '../models/academic-item.js';
import type { NotificationLogEntry, Reminder, TelegramBatch } from '../models/bot.js';
import type { ClassSlot } from '../models/class-schedule.js';
import type { PortalDocument } from '../models/portal-document.js';
import type { RunHistory, TelegramState } from '../models/run.js';
import type { AcademicRepository } from './repository.js';

export class InMemoryAcademicRepository implements AcademicRepository {
  readonly items = new Map<string, AcademicItem>();
  readonly statuses = new Map<string, UserTaskStatus>();
  readonly runs: RunHistory[] = [];
  readonly telegramTaskMessages = new Map<string, TelegramTaskMessage>();
  readonly reminders = new Map<string, Reminder>();
  readonly notificationLog = new Map<string, NotificationLogEntry>();
  readonly batches = new Map<string, TelegramBatch>();
  telegramState: TelegramState = { lastUpdateId: 0 };
  classSchedule: ClassSlot[] = [];
  readonly documents = new Map<string, PortalDocument>();

  initialize(): Promise<void> {
    return Promise.resolve();
  }

  listDetectedItems(): Promise<AcademicItem[]> {
    return Promise.resolve(Array.from(this.items.values()));
  }

  upsertDetectedItems(items: AcademicItem[]): Promise<void> {
    for (const item of items) this.items.set(item.id, structuredClone(item));
    return Promise.resolve();
  }

  listTaskStatuses(): Promise<UserTaskStatus[]> {
    return Promise.resolve(Array.from(this.statuses.values()));
  }

  upsertTaskStatus(status: UserTaskStatus): Promise<void> {
    this.statuses.set(status.itemId, structuredClone(status));
    return Promise.resolve();
  }

  listTelegramTaskMessages(): Promise<TelegramTaskMessage[]> {
    return Promise.resolve(Array.from(this.telegramTaskMessages.values()));
  }

  upsertTelegramTaskMessage(message: TelegramTaskMessage): Promise<void> {
    this.telegramTaskMessages.set(message.itemId, structuredClone(message));
    return Promise.resolve();
  }

  listReminders(): Promise<Reminder[]> {
    return Promise.resolve(Array.from(this.reminders.values()));
  }

  upsertReminder(reminder: Reminder): Promise<void> {
    this.reminders.set(reminder.itemId, structuredClone(reminder));
    return Promise.resolve();
  }

  listNotificationLog(): Promise<NotificationLogEntry[]> {
    return Promise.resolve(Array.from(this.notificationLog.values()));
  }

  upsertNotificationLog(entries: NotificationLogEntry[]): Promise<void> {
    for (const entry of entries) this.notificationLog.set(entry.itemId, structuredClone(entry));
    return Promise.resolve();
  }

  listBatches(): Promise<TelegramBatch[]> {
    return Promise.resolve(Array.from(this.batches.values()));
  }

  insertBatch(batch: TelegramBatch): Promise<void> {
    this.batches.set(batch.batchId, structuredClone(batch));
    return Promise.resolve();
  }

  appendRunHistory(run: RunHistory): Promise<void> {
    this.runs.push(structuredClone(run));
    return Promise.resolve();
  }

  getTelegramState(): Promise<TelegramState> {
    return Promise.resolve(structuredClone(this.telegramState));
  }

  setTelegramState(state: TelegramState): Promise<void> {
    this.telegramState = structuredClone(state);
    return Promise.resolve();
  }

  listClassSchedule(): Promise<ClassSlot[]> {
    return Promise.resolve(structuredClone(this.classSchedule));
  }

  replaceClassSchedule(slots: ClassSlot[]): Promise<void> {
    this.classSchedule = structuredClone(slots);
    return Promise.resolve();
  }

  listPortalDocuments(): Promise<PortalDocument[]> {
    return Promise.resolve(
      Array.from(this.documents.values()).map((document) => {
        const copy = structuredClone(document);
        delete copy.text;
        return copy;
      }),
    );
  }

  listPortalDocumentTexts(): Promise<Map<string, string>> {
    return Promise.resolve(
      new Map(
        Array.from(this.documents.values())
          .filter((document) => document.text)
          .map((document) => [document.id, document.text!]),
      ),
    );
  }

  upsertPortalDocuments(documents: PortalDocument[]): Promise<void> {
    for (const document of documents) {
      const previous = this.documents.get(document.id);
      this.documents.set(document.id, {
        ...structuredClone(document),
        ...(document.text ? {} : previous?.text ? { text: previous.text } : {}),
      });
    }
    return Promise.resolve();
  }
}
