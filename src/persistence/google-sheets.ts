import { google, type sheets_v4 } from 'googleapis';
import type { GoogleCredentials } from '../config/env.js';
import { createGoogleOAuthClient } from '../google/auth.js';
import type {
  AcademicItem,
  ItemSource,
  ItemStatus,
  ItemType,
  TelegramTaskMessage,
  Urgency,
  UserTaskStatus,
} from '../models/academic-item.js';
import type { RunHistory, TelegramState } from '../models/run.js';
import type { AcademicRepository } from './repository.js';

const tables = {
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
  user_task_status: ['itemId', 'status', 'updatedAt', 'source'],
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
  telegram_state: ['lastUpdateId'],
  telegram_task_messages: ['itemId', 'chatId', 'messageId', 'lastRenderedStatus', 'updatedAt'],
} as const;

type TableName = keyof typeof tables;

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
    status: (row[15] ?? 'TODO') as ItemStatus,
    urgency: (row[16] ?? 'INFORMATIONAL') as Urgency,
    ...(metadata ? { metadata } : {}),
  };
}

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
    await Promise.all(
      (Object.keys(tables) as TableName[]).map((name) =>
        this.sheets.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: `'${name}'!A1`,
          valueInputOption: 'RAW',
          requestBody: { values: [Array.from(tables[name])] },
        }),
      ),
    );
  }

  private async rows(name: TableName): Promise<string[][]> {
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `'${name}'!A2:Z`,
    });
    return (response.data.values ?? []).map((row) => row.map(String));
  }

  private async upsertRows(name: TableName, rows: string[][]): Promise<void> {
    const existing = await this.rows(name);
    const index = new Map(existing.map((row, offset) => [row[0], offset + 2]));
    const updates = rows.filter((row) => index.has(row[0]));
    const inserts = rows.filter((row) => !index.has(row[0]));

    await Promise.all(
      updates.map((row) =>
        this.sheets.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: `'${name}'!A${String(index.get(row[0]))}`,
          valueInputOption: 'RAW',
          requestBody: { values: [row] },
        }),
      ),
    );
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
    return (await this.rows('user_task_status'))
      .filter((row) => row[0])
      .map((row) => ({
        itemId: row[0] ?? '',
        status: (row[1] ?? 'TODO') as ItemStatus,
        updatedAt: row[2] ?? '',
        source: (row[3] ?? 'SYSTEM') as UserTaskStatus['source'],
      }));
  }

  async upsertTaskStatus(status: UserTaskStatus): Promise<void> {
    await this.upsertRows('user_task_status', [
      [status.itemId, status.status, status.updatedAt, status.source],
    ]);
  }

  async listTelegramTaskMessages(): Promise<TelegramTaskMessage[]> {
    return (await this.rows('telegram_task_messages'))
      .filter((row) => row[0])
      .map((row) => ({
        itemId: row[0] ?? '',
        chatId: row[1] ?? '',
        messageId: Number(row[2] ?? 0),
        lastRenderedStatus: (row[3] ?? 'TODO') as ItemStatus,
        updatedAt: row[4] ?? '',
      }));
  }

  async upsertTelegramTaskMessage(message: TelegramTaskMessage): Promise<void> {
    await this.upsertRows('telegram_task_messages', [
      [
        message.itemId,
        message.chatId,
        String(message.messageId),
        message.lastRenderedStatus,
        message.updatedAt,
      ],
    ]);
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
    return { lastUpdateId: Number(rows[0]?.[0] ?? 0) };
  }

  async setTelegramState(state: TelegramState): Promise<void> {
    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: "'telegram_state'!A2",
      valueInputOption: 'RAW',
      requestBody: { values: [[String(state.lastUpdateId)]] },
    });
  }
}
