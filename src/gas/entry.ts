/**
 * Ponto de entrada do bot no Google Apps Script (webhook do Telegram).
 * Empacotado por `npm run build:gas` em apps-script/Bot.gs; o Code.gs só repassa as chamadas.
 * Não importe módulos que dependam do Node aqui.
 */
import { dueReminders, handleUpdate, type BotEffect, type PendingInput } from '../bot/core.js';
import { createRenderContext } from '../bot/screens.js';
import { applyUserStatuses } from '../bot/status.js';
import type { Reminder } from '../models/bot.js';
import {
  academicItemFromRow,
  batchFromRow,
  reminderFromRow,
  reminderToRow,
  tables,
  userStatusFromRow,
  userStatusToRow,
  type TableName,
} from '../persistence/rows.js';
import type { TelegramUpdate } from '../telegram/types.js';

interface BotProperties {
  botToken: string;
  chatId: string;
  sheetId: string;
  webhookSecret: string;
}

function properties(): BotProperties {
  const store = PropertiesService.getScriptProperties();
  const result = {
    botToken: store.getProperty('TELEGRAM_BOT_TOKEN') ?? '',
    chatId: store.getProperty('TELEGRAM_CHAT_ID') ?? '',
    sheetId: store.getProperty('GOOGLE_SHEET_ID') ?? '',
    webhookSecret: store.getProperty('TELEGRAM_WEBHOOK_SECRET') ?? '',
  };
  const missing = Object.entries(result)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length > 0) throw new Error(`Propriedades ausentes: ${missing.join(', ')}`);
  return result;
}

function cell(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/** Acesso às abas da planilha com as mesmas colunas usadas pelo monitor (persistence/rows). */
class SheetStore {
  private readonly cache = new Map<TableName, string[][]>();

  constructor(private readonly spreadsheet: GasSheets.Spreadsheet) {}

  private sheet(name: TableName): GasSheets.Sheet {
    const existing = this.spreadsheet.getSheetByName(name);
    if (existing) return existing;
    const created = this.spreadsheet.insertSheet(name);
    created.appendRow(Array.from(tables[name]));
    return created;
  }

  rows(name: TableName): string[][] {
    const cached = this.cache.get(name);
    if (cached) return cached;
    const values = this.sheet(name)
      .getDataRange()
      .getValues()
      .slice(1)
      .map((row) => row.map(cell));
    const rows = values.filter((row) => row[0]);
    this.cache.set(name, rows);
    return rows;
  }

  upsert(name: TableName, row: string[]): void {
    const sheet = this.sheet(name);
    const values = sheet.getDataRange().getValues();
    const index = values.findIndex(
      (existing, position) => position > 0 && cell(existing[0]) === row[0],
    );
    if (index > 0) sheet.getRange(index + 1, 1, 1, row.length).setValues([row]);
    else sheet.appendRow(row);
    this.cache.delete(name);
  }

  lastSyncAt(): string | undefined {
    const runs = this.rows('run_history');
    const finished = runs
      .map((row) => row[2] ?? '')
      .filter(Boolean)
      .sort();
    return finished[finished.length - 1];
  }
}

function telegram(token: string, method: string, payload: Record<string, unknown>): void {
  const response = UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() >= 400) {
    const text = response.getContentText();
    // Repetir a mesma ação (ex.: tocar duas vezes) não é erro.
    if (/message is not modified|query is too old/i.test(text)) return;
    throw new Error(`Telegram rejeitou ${method}: ${text}`);
  }
}

const pendingKey = (chatId: string) => `pending:${chatId}`;

function readPending(chatId: string): PendingInput | undefined {
  const raw = CacheService.getScriptCache().get(pendingKey(chatId));
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as PendingInput;
  } catch {
    return undefined;
  }
}

function applyEffects(effects: BotEffect[], props: BotProperties, store: SheetStore): void {
  const chat = { chat_id: props.chatId };
  for (const effect of effects) {
    switch (effect.type) {
      case 'answer':
        try {
          telegram(props.botToken, 'answerCallbackQuery', {
            callback_query_id: effect.callbackId,
            ...(effect.text ? { text: effect.text } : {}),
          });
        } catch (error) {
          console.error(String(error));
        }
        break;
      case 'edit':
        telegram(props.botToken, 'editMessageText', {
          ...chat,
          message_id: effect.messageId,
          text: effect.text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup: { inline_keyboard: effect.keyboard },
        });
        break;
      case 'editKeyboard':
        telegram(props.botToken, 'editMessageReplyMarkup', {
          ...chat,
          message_id: effect.messageId,
          reply_markup: { inline_keyboard: effect.keyboard },
        });
        break;
      case 'send':
        telegram(props.botToken, 'sendMessage', {
          ...chat,
          text: effect.text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          ...(effect.forceReply
            ? { reply_markup: { force_reply: true, input_field_placeholder: 'Ex.: amanhã 9h' } }
            : effect.keyboard && effect.keyboard.length > 0
              ? { reply_markup: { inline_keyboard: effect.keyboard } }
              : {}),
        });
        break;
      case 'setStatus':
        store.upsert('user_task_status', userStatusToRow(effect.record));
        break;
      case 'setReminder':
        store.upsert('reminders', reminderToRow(effect.reminder));
        break;
      case 'setPending':
        if (effect.pending) {
          CacheService.getScriptCache().put(
            pendingKey(props.chatId),
            JSON.stringify(effect.pending),
            900,
          );
        } else {
          CacheService.getScriptCache().remove(pendingKey(props.chatId));
        }
        break;
    }
  }
}

function renderContext(store: SheetStore, now: Date) {
  const items = applyUserStatuses(
    store.rows('detected_items').map(academicItemFromRow),
    store.rows('user_task_status').map(userStatusFromRow),
  );
  const lastSyncAt = store.lastSyncAt();
  return createRenderContext({
    now,
    items,
    reminders: store.rows('reminders').map(reminderFromRow),
    batches: store.rows('telegram_batches').map(batchFromRow),
    ...(lastSyncAt ? { lastSyncAt } : {}),
  });
}

function withLock<T>(work: () => T): T {
  const lock = LockService.getScriptLock();
  lock.waitLock(20_000);
  try {
    return work();
  } finally {
    lock.releaseLock();
  }
}

/**
 * Webhook do Telegram. Responde com HtmlService (HTTP 200 direto, sem o redirecionamento do
 * ContentService) e ignora entregas repetidas do mesmo update.
 */
export function doPost(event: {
  parameter?: Record<string, string>;
  postData?: { contents?: string };
}): unknown {
  const ok = HtmlService.createHtmlOutput('ok');
  try {
    const props = properties();
    if (event.parameter?.secret !== props.webhookSecret)
      return HtmlService.createHtmlOutput('unauthorized');
    const update = JSON.parse(event.postData?.contents ?? '{}') as TelegramUpdate;
    const cache = CacheService.getScriptCache();
    const seenKey = `update:${String(update.update_id)}`;
    if (cache.get(seenKey)) return ok;
    cache.put(seenKey, '1', 21_600);
    withLock(() => {
      const store = new SheetStore(SpreadsheetApp.openById(props.sheetId));
      const now = new Date();
      const pending = readPending(props.chatId);
      const effects = handleUpdate(
        update,
        {
          chatId: props.chatId,
          context: renderContext(store, now),
          ...(pending ? { pending } : {}),
        },
        now,
      );
      applyEffects(effects, props, store);
    });
  } catch (error) {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  }
  return ok;
}

/** Acionador de tempo (a cada 5 minutos): envia os lembretes que venceram. */
export function processReminders(): void {
  const props = properties();
  withLock(() => {
    const store = new SheetStore(SpreadsheetApp.openById(props.sheetId));
    const now = new Date();
    const due: Reminder[] = store
      .rows('reminders')
      .map(reminderFromRow)
      .filter(
        (reminder) => !reminder.sentAt && new Date(reminder.remindAt).getTime() <= now.getTime(),
      );
    if (due.length === 0) return;
    applyEffects(dueReminders(due, renderContext(store, now), now), props, store);
  });
}

/** Envia o painel (menu) para o chat; útil para testar o bot depois de publicar. */
export function sendPanel(): string {
  const props = properties();
  withLock(() => {
    const store = new SheetStore(SpreadsheetApp.openById(props.sheetId));
    const now = new Date();
    const effects = handleUpdate(
      {
        update_id: 0,
        message: { message_id: 0, chat: { id: Number(props.chatId) }, text: '/painel' },
      },
      { chatId: props.chatId, context: renderContext(store, now) },
      now,
    );
    applyEffects(effects, props, store);
  });
  return 'Painel enviado.';
}

/** Registra este Web App como webhook do Telegram. */
export function setupWebhook(): string {
  const props = properties();
  const url = ScriptApp.getService().getUrl();
  if (!url) throw new Error('Publique o projeto como App da Web antes de configurar o webhook.');
  telegram(props.botToken, 'setWebhook', {
    url: `${url}?secret=${encodeURIComponent(props.webhookSecret)}`,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: false,
    max_connections: 5,
  });
  return webhookInfo();
}

export function deleteWebhook(): string {
  telegram(properties().botToken, 'deleteWebhook', { drop_pending_updates: false });
  return 'Webhook removido.';
}

/** Situação do webhook segundo o Telegram (sem expor o token). */
export function webhookInfo(): string {
  const response = UrlFetchApp.fetch(
    `https://api.telegram.org/bot${properties().botToken}/getWebhookInfo`,
    { method: 'get', muteHttpExceptions: true },
  );
  const info =
    (JSON.parse(response.getContentText()) as { result?: Record<string, unknown> }).result ?? {};
  const url = typeof info.url === 'string' ? info.url.replace(/secret=[^&]+/, 'secret=***') : '';
  return JSON.stringify({ ...info, url });
}
