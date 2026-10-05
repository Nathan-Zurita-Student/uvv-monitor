import { google, type sheets_v4 } from 'googleapis';
import type { GoogleCredentials } from '../config/env.js';
import { createGoogleOAuthClient } from '../google/auth.js';
import type { AcademicItem, TelegramTaskMessage, UserTaskStatus } from '../models/academic-item.js';
import type { NotificationLogEntry, Reminder, TelegramBatch } from '../models/bot.js';
import { classSlotFromRow, classSlotToRow, type ClassSlot } from '../models/class-schedule.js';
import {
  portalDocumentFromRow,
  portalDocumentToRow,
  type PortalDocument,
} from '../models/portal-document.js';
import type { RunHistory, TelegramState } from '../models/run.js';
import type { AcademicRepository } from './repository.js';
import {
  academicItemFromRow,
  academicItemToRow,
  batchFromRow,
  batchToRow,
  notificationLogFromRow,
  notificationLogToRow,
  reminderFromRow,
  reminderToRow,
  tables,
  telegramTaskMessageFromRow,
  telegramTaskMessageToRow,
  userStatusFromRow,
  userStatusToRow,
  type TableName,
} from './rows.js';

export { academicItemFromRow, academicItemToRow } from './rows.js';

export class GoogleSheetsAcademicRepository implements AcademicRepository {
  constructor(
    private readonly sheets: sheets_v4.Sheets,
    private readonly spreadsheetId: string,
  ) {}

  static fromCredentials(credentials: GoogleCredentials): GoogleSheetsAcademicRepository {
    const auth = createGoogleOAuthClient(credentials);
    return new GoogleSheetsAcademicRepository(
      google.sheets({ version: 'v4', auth }),
      credentials.sheetId,
    );
  }

  async initialize(): Promise<void> {
    const spreadsheet = await this.sheets.spreadsheets.get({
      spreadsheetId: this.spreadsheetId,
      fields: 'sheets.properties.title',
    });
    const existing = new Set(
      spreadsheet.data.sheets?.map((sheet) => sheet.properties?.title).filter(Boolean) ?? [],
    );
    const missing = (Object.keys(tables) as TableName[]).filter((name) => !existing.has(name));
    if (missing.length > 0) {
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: {
          requests: missing.map((title) => ({ addSheet: { properties: { title } } })),
        },
      });
    }
    await this.sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: (Object.keys(tables) as TableName[]).map((name) => ({
          range: `'${name}'!A1`,
          values: [Array.from(tables[name])],
        })),
      },
    });
  }

  private async rows(name: TableName): Promise<string[][]> {
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `'${name}'!A2:Z`,
    });
    return (response.data.values ?? []).map((row) => row.map(String));
  }

  private async upsertRows(name: TableName, rows: string[][]): Promise<void> {
    if (rows.length === 0) return;
    const existing = await this.rows(name);
    const index = new Map(existing.map((row, offset) => [row[0], offset + 2]));
    const updates = rows.filter((row) => index.has(row[0]));
    const inserts = rows.filter((row) => !index.has(row[0]));

    if (updates.length > 0) {
      await this.sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: {
          valueInputOption: 'RAW',
          data: updates.map((row) => ({
            range: `'${name}'!A${String(index.get(row[0]))}`,
            values: [row],
          })),
        },
      });
    }
    if (inserts.length > 0) {
      await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: `'${name}'!A:Z`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: inserts },
      });
    }
  }

  async listDetectedItems(): Promise<AcademicItem[]> {
    return (await this.rows('detected_items')).filter((row) => row[0]).map(academicItemFromRow);
  }

  async upsertDetectedItems(items: AcademicItem[]): Promise<void> {
    await this.upsertRows('detected_items', items.map(academicItemToRow));
  }

  async listTaskStatuses(): Promise<UserTaskStatus[]> {
    return (await this.rows('user_task_status')).filter((row) => row[0]).map(userStatusFromRow);
  }

  async upsertTaskStatus(status: UserTaskStatus): Promise<void> {
    await this.upsertRows('user_task_status', [userStatusToRow(status)]);
  }

  async listTelegramTaskMessages(): Promise<TelegramTaskMessage[]> {
    return (await this.rows('telegram_task_messages'))
      .filter((row) => row[0])
      .map(telegramTaskMessageFromRow);
  }

  async upsertTelegramTaskMessage(message: TelegramTaskMessage): Promise<void> {
    await this.upsertRows('telegram_task_messages', [telegramTaskMessageToRow(message)]);
  }

  async listReminders(): Promise<Reminder[]> {
    return (await this.rows('reminders')).filter((row) => row[0]).map(reminderFromRow);
  }

  async upsertReminder(reminder: Reminder): Promise<void> {
    await this.upsertRows('reminders', [reminderToRow(reminder)]);
  }

  async listNotificationLog(): Promise<NotificationLogEntry[]> {
    return (await this.rows('notification_log'))
      .filter((row) => row[0])
      .map(notificationLogFromRow);
  }

  async upsertNotificationLog(entries: NotificationLogEntry[]): Promise<void> {
    await this.upsertRows('notification_log', entries.map(notificationLogToRow));
  }

  async listBatches(): Promise<TelegramBatch[]> {
    return (await this.rows('telegram_batches')).filter((row) => row[0]).map(batchFromRow);
  }

  async insertBatch(batch: TelegramBatch): Promise<void> {
    await this.upsertRows('telegram_batches', [batchToRow(batch)]);
  }

  async appendRunHistory(run: RunHistory): Promise<void> {
    await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: "'run_history'!A:H",
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [
          [
            run.runId,
            run.startedAt,
            run.finishedAt ?? '',
            run.portalStatus,
            run.gmailStatus,
            run.calendarStatus,
            String(run.itemsFound),
            JSON.stringify(run.errors),
          ],
        ],
      },
    });
  }

  async getTelegramState(): Promise<TelegramState> {
    const rows = await this.rows('telegram_state');
    const panelMessageId = Number(rows[0]?.[1] ?? 0);
    return {
      lastUpdateId: Number(rows[0]?.[0] ?? 0),
      ...(panelMessageId > 0 ? { panelMessageId } : {}),
    };
  }

  async setTelegramState(state: TelegramState): Promise<void> {
    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: "'telegram_state'!A2:B2",
      valueInputOption: 'RAW',
      requestBody: {
        values: [
          [String(state.lastUpdateId), state.panelMessageId ? String(state.panelMessageId) : ''],
        ],
      },
    });
  }

  async listClassSchedule(): Promise<ClassSlot[]> {
    return (await this.rows('class_schedule')).flatMap((row) => classSlotFromRow(row) ?? []);
  }

  async replaceClassSchedule(slots: ClassSlot[], updatedAt: string): Promise<void> {
    await this.sheets.spreadsheets.values.clear({
      spreadsheetId: this.spreadsheetId,
      range: "'class_schedule'!A2:Z",
    });
    if (slots.length === 0) return;
    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: "'class_schedule'!A2",
      valueInputOption: 'RAW',
      requestBody: { values: slots.map((slot) => classSlotToRow(slot, updatedAt)) },
    });
  }

  async listPortalDocuments(): Promise<PortalDocument[]> {
    return (await this.rows('portal_documents')).flatMap((row) => portalDocumentFromRow(row) ?? []);
  }

  async listPortalDocumentTexts(): Promise<Map<string, string>> {
    return new Map(
      (await this.rows('portal_document_texts'))
        .filter((row) => row[0] && row[1])
        .map((row) => [row[0]!, row[1]!]),
    );
  }

  async upsertPortalDocuments(documents: PortalDocument[]): Promise<void> {
    await this.upsertRows('portal_documents', documents.map(portalDocumentToRow));
    await this.upsertRows(
      'portal_document_texts',
      documents
        .filter((document) => document.text)
        .map((document) => [document.id, document.text!]),
    );
  }
}
