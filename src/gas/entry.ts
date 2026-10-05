/**
 * Ponto de entrada do bot no Google Apps Script (webhook do Telegram).
 * Empacotado por `npm run build:gas` em apps-script/Bot.gs; o Code.gs só repassa as chamadas.
 * Não importe módulos que dependam do Node aqui.
 */
import {
  dueReminders,
  handleUpdate,
  quickAnswer,
  referencedData,
  type BotEffect,
  type PendingInput,
} from '../bot/core.js';
import { createRenderContext } from '../bot/screens.js';
import { applyUserStatuses } from '../bot/status.js';
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
import {
  conversationInfo,
  handleConversation,
  markConversationSent,
  sendPersonalReminders,
} from './conversation.js';
import { escapeHtml } from '../telegram/html.js';
import { configureConversation } from './configuration.js';

interface BotProperties {
  botToken: string;
  chatId: string;
  sheetId: string;
  webhookSecret: string;
}

function properties(): BotProperties {
  const values = PropertiesService.getScriptProperties().getProperties();
  const result = {
    botToken: values.TELEGRAM_BOT_TOKEN ?? '',
    chatId: values.TELEGRAM_CHAT_ID ?? '',
    sheetId: values.GOOGLE_SHEET_ID ?? '',
    webhookSecret: values.TELEGRAM_WEBHOOK_SECRET ?? '',
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
  constructor(private readonly spreadsheet: GasSheets.Spreadsheet) {}

  private sheet(name: TableName): GasSheets.Sheet {
    const existing = this.spreadsheet.getSheetByName(name);
    if (existing) return existing;
    const created = this.spreadsheet.insertSheet(name);
    created.appendRow(Array.from(tables[name]));
    return created;
  }

  rows(name: TableName): string[][] {
    return this.sheet(name)
      .getDataRange()
      .getValues()
      .slice(1)
      .map((row) => row.map(cell))
      .filter((row) => row[0]);
  }

  /** Atualiza a linha com a mesma chave (1ª coluna) ou acrescenta; lê só a coluna das chaves. */
  upsert(name: TableName, row: string[]): void {
    const sheet = this.sheet(name);
    const lastRow = sheet.getLastRow();
    const keys = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 1).getValues() : [];
    const index = keys.findIndex((existing) => cell(existing[0]) === row[0]);
    if (index >= 0) sheet.getRange(index + 2, 1, 1, row.length).setValues([row]);
    else sheet.appendRow(row);
  }
}

// ---------------------------------------------------------------------------------------------
// Cópia da planilha no cache

/**
 * Abrir e ler a planilha leva 2 s ou mais; a cópia comprimida no CacheService sai em ~0,1 s.
 * As atividades (grandes, mudam só na coleta) ficam separadas do estado do usuário (pequeno,
 * muda a cada toque). O monitor pede uma cópia nova ao fim de cada coleta, e o acionador de
 * lembretes a renova se estiver com mais de 30 minutos.
 */
interface Snapshot {
  builtAt: string;
  lastSyncAt?: string;
  items: string[][];
  statuses: string[][];
  reminders: string[][];
  batches: string[][];
}

type SnapshotState = Omit<Snapshot, 'items'>;

const ITEMS_KEY = 'snap.items';
const STATE_KEY = 'snap.state';
/** O CacheService aceita até 100 KB por valor. */
const CHUNK_SIZE = 90_000;
const MAX_CHUNKS = 10;
/** Máximo permitido pelo CacheService (6 horas). */
const CACHE_TTL_SECONDS = 21_600;
const MAX_SNAPSHOT_AGE_MS = 30 * 60_000;
/** Lotes antigos (paginadores de mensagens velhas) são lidos da planilha quando aparecem. */
const MAX_CACHED_BATCHES = 100;

function chunkKeys(prefix: string): string[] {
  return [
    prefix,
    ...Array.from({ length: MAX_CHUNKS }, (_, index) => `${prefix}.${String(index)}`),
  ];
}

function pack(prefix: string, value: unknown): Record<string, string> | undefined {
  const blob = Utilities.newBlob(JSON.stringify(value), 'application/json');
  const encoded = Utilities.base64Encode(Utilities.gzip(blob).getBytes());
  const count = Math.ceil(encoded.length / CHUNK_SIZE);
  if (count > MAX_CHUNKS) return undefined;
  const values: Record<string, string> = { [prefix]: String(count) };
  for (let index = 0; index < count; index += 1) {
    values[`${prefix}.${String(index)}`] = encoded.slice(
      index * CHUNK_SIZE,
      (index + 1) * CHUNK_SIZE,
    );
  }
  return values;
}

function unpack<T>(prefix: string, values: Record<string, string>): T | undefined {
  const count = Number(values[prefix] ?? 0);
  if (!count) return undefined;
  const parts: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const part = values[`${prefix}.${String(index)}`];
    // O cache pode descartar um pedaço a qualquer momento: aí a cópia é refeita.
    if (!part) return undefined;
    parts.push(part);
  }
  try {
    const blob = Utilities.newBlob(Utilities.base64Decode(parts.join('')), 'application/x-gzip');
    return JSON.parse(Utilities.ungzip(blob).getDataAsString()) as T;
  } catch {
    return undefined;
  }
}

function readState(): SnapshotState | undefined {
  return unpack<SnapshotState>(
    STATE_KEY,
    CacheService.getScriptCache().getAll(chunkKeys(STATE_KEY)),
  );
}

function readSnapshot(): Snapshot | undefined {
  const values = CacheService.getScriptCache().getAll([
    ...chunkKeys(STATE_KEY),
    ...chunkKeys(ITEMS_KEY),
  ]);
  const state = unpack<SnapshotState>(STATE_KEY, values);
  const items = unpack<string[][]>(ITEMS_KEY, values);
  return state && items ? { ...state, items } : undefined;
}

function saveSnapshot(snapshot: Snapshot, withItems: boolean): void {
  const cache = CacheService.getScriptCache();
  const { items, ...state } = snapshot;
  const packedState = pack(STATE_KEY, {
    ...state,
    batches: state.batches.slice(-MAX_CACHED_BATCHES),
  });
  const packedItems = withItems ? pack(ITEMS_KEY, items) : {};
  if (!packedState || !packedItems) {
    // Grande demais para o cache: cada toque volta a ler a planilha (mais lento, mas correto).
    cache.removeAll([STATE_KEY, ITEMS_KEY]);
    return;
  }
  cache.putAll({ ...packedState, ...packedItems }, CACHE_TTL_SECONDS);
}

/** Lê as abas usadas pelo bot e guarda a cópia no cache. */
function buildSnapshot(props: BotProperties): Snapshot {
  const store = new SheetStore(SpreadsheetApp.openById(props.sheetId));
  const finished = store
    .rows('run_history')
    .map((row) => row[2] ?? '')
    .filter(Boolean)
    .sort();
  const lastSyncAt = finished[finished.length - 1];
  const snapshot: Snapshot = {
    builtAt: new Date().toISOString(),
    ...(lastSyncAt ? { lastSyncAt } : {}),
    items: store.rows('detected_items'),
    statuses: store.rows('user_task_status'),
    reminders: store.rows('reminders'),
    batches: store.rows('telegram_batches'),
  };
  try {
    saveSnapshot(snapshot, true);
  } catch (error) {
    console.error(`Cópia em cache não salva: ${String(error)}`);
  }
  return snapshot;
}

function covers(snapshot: Snapshot, needed: { itemIds: string[]; batchIds: string[] }): boolean {
  const has = (rows: string[][], key: string) => rows.some((row) => row[0] === key);
  return (
    needed.itemIds.every((id) => has(snapshot.items, id)) &&
    needed.batchIds.every((id) => has(snapshot.batches, id))
  );
}

/** Cópia do cache; relê a planilha se ela sumiu ou não tem o que o toque precisa (coleta nova). */
function loadSnapshot(
  props: BotProperties,
  needed: { itemIds: string[]; batchIds: string[] } = { itemIds: [], batchIds: [] },
): Snapshot {
  const cached = readSnapshot();
  return cached && covers(cached, needed) ? cached : buildSnapshot(props);
}

function renderContext(snapshot: Snapshot, now: Date) {
  return createRenderContext({
    now,
    items: applyUserStatuses(
      snapshot.items.map(academicItemFromRow),
      snapshot.statuses.map(userStatusFromRow),
    ),
    reminders: snapshot.reminders.map(reminderFromRow),
    batches: snapshot.batches.map(batchFromRow),
    ...(snapshot.lastSyncAt ? { lastSyncAt: snapshot.lastSyncAt } : {}),
  });
}

// ---------------------------------------------------------------------------------------------
// Telegram e gravação

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

interface SheetWrite {
  table: 'user_task_status' | 'reminders';
  row: string[];
}

/** Executa as ações no Telegram e devolve o que precisa ser gravado na planilha. */
function sendEffects(effects: BotEffect[], props: BotProperties): SheetWrite[] {
  const chat = { chat_id: props.chatId };
  const writes: SheetWrite[] = [];
  for (const effect of effects) {
    try {
      switch (effect.type) {
        case 'answer':
          telegram(props.botToken, 'answerCallbackQuery', {
            callback_query_id: effect.callbackId,
            ...(effect.text ? { text: effect.text } : {}),
          });
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
          writes.push({ table: 'user_task_status', row: userStatusToRow(effect.record) });
          break;
        case 'setReminder':
          writes.push({ table: 'reminders', row: reminderToRow(effect.reminder) });
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
    } catch (error) {
      // Uma mensagem que não pôde ser editada (apagada, antiga) não impede gravar a ação.
      console.error(String(error));
    }
  }
  return writes;
}

function withRow(rows: string[][], row: string[]): string[][] {
  const index = rows.findIndex((existing) => existing[0] === row[0]);
  return index >= 0
    ? rows.map((existing, position) => (position === index ? row : existing))
    : [...rows, row];
}

/** Grava na planilha e atualiza a cópia em cache (que os próximos toques vão usar). */
function persist(writes: SheetWrite[], snapshot: Snapshot, props: BotProperties): void {
  if (writes.length === 0) return;
  const store = new SheetStore(SpreadsheetApp.openById(props.sheetId));
  let updated = snapshot;
  for (const { table, row } of writes) {
    store.upsert(table, row);
    updated =
      table === 'user_task_status'
        ? { ...updated, statuses: withRow(updated.statuses, row) }
        : { ...updated, reminders: withRow(updated.reminders, row) };
  }
  saveSnapshot(updated, false);
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

// ---------------------------------------------------------------------------------------------
// Funções chamadas pelo Code.gs

/**
 * Webhook do Telegram. Responde com HtmlService (HTTP 200 direto, sem o redirecionamento do
 * ContentService) e ignora entregas repetidas do mesmo update. O monitor também chama esta URL
 * com `{"uvv":"refresh"}` ao fim de cada coleta para renovar a cópia em cache.
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
    const update = JSON.parse(event.postData?.contents ?? '{}') as TelegramUpdate & {
      uvv?: string;
      configuration?: unknown;
    };
    if (update.uvv === 'configure_chat') {
      return withLock(() =>
        HtmlService.createHtmlOutput(configureConversation(update.configuration)),
      );
    }
    if (update.uvv === 'refresh') {
      withLock(() => buildSnapshot(props));
      return ok;
    }
    const incomingChat = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
    if (
      String(incomingChat ?? '') !== props.chatId ||
      !Number.isSafeInteger(update.update_id) ||
      update.update_id < 0
    )
      return ok;
    const cache = CacheService.getScriptCache();
    const seenKey = `update:${String(update.update_id)}`;
    if (cache.get(seenKey)) return ok;
    // Responde o toque antes de carregar os dados: o botão para de "carregar" na hora.
    const quick = quickAnswer(update, props.chatId);
    if (quick) sendEffects([quick], props);
    withLock(() => {
      if (cache.get(seenKey)) return;
      const now = new Date();
      const pending = readPending(props.chatId);
      const snapshot = loadSnapshot(props, referencedData(update, pending));
      const text = update.message?.text?.trim();
      const chatCommand = /^\/(?:gastos|esquecer|cancelar)(?:@\w+)?$/i.test(text ?? '');
      if (text && (chatCommand || (!text.startsWith('/') && !pending))) {
        const store = new SheetStore(SpreadsheetApp.openById(props.sheetId));
        try {
          const result = handleConversation({
            text,
            updateId: update.update_id,
            chatId: props.chatId,
            items: renderContext(snapshot, now).items,
            now,
            store,
            ...(update.message?.reply_to_message?.text
              ? { replyContext: update.message.reply_to_message.text }
              : {}),
          });
          if (!result.replay) {
            telegram(props.botToken, 'sendMessage', {
              chat_id: props.chatId,
              text: escapeHtml(result.reply),
              parse_mode: 'HTML',
            });
            markConversationSent(store, update.update_id);
          }
          if (/^\/(?:esquecer|cancelar)/i.test(text)) cache.remove(pendingKey(props.chatId));
          buildSnapshot(props);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Não consegui atender esse pedido agora.';
          telegram(props.botToken, 'sendMessage', {
            chat_id: props.chatId,
            text: escapeHtml(message),
            parse_mode: 'HTML',
          });
        }
        cache.put(seenKey, '1', 21_600);
        return;
      }
      const effects = handleUpdate(
        update,
        {
          chatId: props.chatId,
          context: renderContext(snapshot, now),
          ...(pending ? { pending } : {}),
          ...(quick ? { answered: true } : {}),
        },
        now,
      );
      // A mensagem é redesenhada primeiro; a planilha é gravada em seguida.
      persist(sendEffects(effects, props), snapshot, props);
      cache.put(seenKey, '1', 21_600);
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
    const now = new Date();
    const store = new SheetStore(SpreadsheetApp.openById(props.sheetId));
    const snapshotForPersonal = loadSnapshot(props);
    sendPersonalReminders(
      store,
      props.chatId,
      renderContext(snapshotForPersonal, now).items,
      now,
      (text) =>
        telegram(props.botToken, 'sendMessage', {
          chat_id: props.chatId,
          text,
          parse_mode: 'HTML',
        }),
    );
    const state = readState();
    const fresh = state && now.getTime() - Date.parse(state.builtAt) <= MAX_SNAPSHOT_AGE_MS;
    // Sem cópia recente, relê a planilha: isso também deixa o cache pronto para os botões.
    const built = fresh ? undefined : buildSnapshot(props);
    const due = (built ?? state)?.reminders
      .map(reminderFromRow)
      .filter((reminder) => !reminder.sentAt && Date.parse(reminder.remindAt) <= now.getTime());
    if (!due || due.length === 0) return;
    const snapshot = built ?? loadSnapshot(props);
    persist(
      sendEffects(dueReminders(due, renderContext(snapshot, now), now), props),
      snapshot,
      props,
    );
  });
}

export { conversationInfo };

/** Relê a planilha e renova a cópia em cache; devolve um resumo para conferência no editor. */
export function refreshCache(): string {
  const props = properties();
  const started = Date.now();
  const snapshot = withLock(() => buildSnapshot(props));
  const cached = readSnapshot();
  return JSON.stringify({
    cached: Boolean(cached && cached.items.length === snapshot.items.length),
    ms: Date.now() - started,
    items: snapshot.items.length,
    statuses: snapshot.statuses.length,
    reminders: snapshot.reminders.length,
    batches: snapshot.batches.length,
    lastSyncAt: snapshot.lastSyncAt ?? null,
  });
}

/** Envia o painel (menu) para o chat; útil para testar o bot depois de publicar. */
export function sendPanel(): string {
  const props = properties();
  withLock(() => {
    const now = new Date();
    const snapshot = loadSnapshot(props);
    const effects = handleUpdate(
      {
        update_id: 0,
        message: { message_id: 0, chat: { id: Number(props.chatId) }, text: '/painel' },
      },
      { chatId: props.chatId, context: renderContext(snapshot, now) },
      now,
    );
    persist(sendEffects(effects, props), snapshot, props);
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
