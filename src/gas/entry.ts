/**
 * Ponto de entrada do bot no Google Apps Script (webhook do Telegram).
 * Empacotado por `npm run build:gas` em apps-script/Bot.gs; o Code.gs só repassa as chamadas.
 * Não importe módulos que dependam do Node aqui.
 */
import { addDays, dayRange } from '../assistant/dates.js';
import type { CalendarEvent } from '../assistant/types.js';
import { decodeCallback } from '../bot/callbacks.js';
import {
  dueReminders,
  handleUpdate,
  needsCalendar,
  quickAnswer,
  referencedData,
  type BotEffect,
  type PendingInput,
} from '../bot/core.js';
import { reminderFromRow, reminderToRow, userStatusToRow } from '../persistence/rows.js';
import type { TelegramUpdate } from '../telegram/types.js';
import { localDateKey } from '../utils/dates.js';
import {
  assistantReply,
  assistPrompt,
  confirmFromButton,
  conversationInfo,
  proactiveDue,
  proactiveNudge,
  sendDuePersonalReminders,
  sendReply,
  type AssistantEnv,
} from './assistant.js';
import {
  manualDispatch,
  manualDispatchText,
  scheduledDispatch,
  tokenProblemNotice,
} from './collector-dispatch.js';
import { configureConversation } from './configuration.js';
import { GasCalendar } from './google-api.js';
import {
  buildSnapshot,
  loadSnapshot,
  MAX_SNAPSHOT_AGE_MS,
  persist,
  readSnapshot,
  readState,
  renderContextOf,
  type SheetWrite,
} from './snapshot.js';
import { sendFilesById, sendHtml, telegram, type BotProperties } from './telegram-api.js';

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
        case 'sendFiles':
          sendFilesById(props, effect.files);
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

function withLock<T>(work: () => T): T {
  const lock = LockService.getScriptLock();
  lock.waitLock(20_000);
  try {
    return work();
  } finally {
    lock.releaseLock();
  }
}

/** Compromissos da Google Agenda dos próximos 14 dias (telas Hoje/Semana/Calendário). */
function upcomingEvents(now: Date): { events?: CalendarEvent[]; error?: boolean } {
  try {
    const today = localDateKey(now);
    const range = dayRange(today, addDays(today, 13));
    const calendarId =
      PropertiesService.getScriptProperties().getProperty('GOOGLE_CALENDAR_ID') || 'primary';
    return { events: new GasCalendar(calendarId).list(range.start, range.end) };
  } catch (error) {
    console.error(`Agenda indisponível: ${String(error)}`);
    return { error: true };
  }
}

/** Mensagens livres (e /gastos, /esquecer) vão para o assistente com GPT. */
function isConversation(text: string | undefined, pending: PendingInput | undefined): boolean {
  if (!text) return false;
  if (/^\/(?:gastos|esquecer|cancelar)(?:@\w+)?$/i.test(text)) return true;
  return !text.startsWith('/') && !pending;
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
        ContentService.createTextOutput(configureConversation(update.configuration)).setMimeType(
          ContentService.MimeType.JSON,
        ),
      );
    }
    if (update.uvv === 'refresh') {
      withLock(() => buildSnapshot(props.sheetId));
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

    const action = update.callback_query
      ? decodeCallback(update.callback_query.data ?? '')
      : undefined;
    const text = update.message?.text?.trim();
    // "Verificar Portal agora" / "/atualizar": dispara a coleta no GitHub Actions.
    if (action?.type === 'sync' || /^\/(?:atualizar|verificar)(?:@\w+)?$/i.test(text ?? '')) {
      cache.put(seenKey, '1', 21_600);
      if (update.callback_query && !quick) {
        sendEffects([{ type: 'answer', callbackId: update.callback_query.id }], props);
      }
      sendHtml(props, manualDispatchText[manualDispatch()]);
      return ok;
    }
    if (
      action?.type === 'confirm' ||
      action?.type === 'assist' ||
      (!update.callback_query && isConversation(text, readPending(props.chatId)))
    ) {
      // Conversa com o GPT: marca o update já (sem chamadas duplicadas) e roda fora do lock
      // principal, para não segurar os botões enquanto o modelo pensa.
      cache.put(seenKey, '1', 21_600);
      const env: AssistantEnv = { props, snapshot: loadSnapshot(props.sheetId), now: new Date() };
      if (action?.type === 'confirm') {
        if (!quick) sendEffects([{ type: 'answer', callbackId: update.callback_query!.id }], props);
        const messageId = update.callback_query?.message?.message_id;
        if (messageId) {
          sendEffects([{ type: 'editKeyboard', messageId, keyboard: [] }], props);
        }
        sendHtml(props, confirmFromButton(env, action.actionId, action.accept));
        return ok;
      }
      if (action?.type === 'assist') {
        const prompt = assistPrompt(env, action.itemId);
        if (!prompt) sendHtml(props, 'Essa atividade não está mais na lista.');
        else sendReply(env, assistantReply(env, { text: prompt, updateId: update.update_id }));
        return ok;
      }
      sendReply(
        env,
        assistantReply(env, {
          text: text ?? '',
          updateId: update.update_id,
          ...(update.message?.reply_to_message?.text
            ? { replyContext: update.message.reply_to_message.text }
            : {}),
        }),
      );
      if (/^\/(?:esquecer|cancelar)/i.test(text ?? '')) cache.remove(pendingKey(props.chatId));
      return ok;
    }

    withLock(() => {
      if (cache.get(seenKey)) return;
      const now = new Date();
      const pending = readPending(props.chatId);
      const snapshot = loadSnapshot(props.sheetId, referencedData(update, pending));
      const calendar = needsCalendar(update) ? upcomingEvents(now) : undefined;
      const effects = handleUpdate(
        update,
        {
          chatId: props.chatId,
          context: renderContextOf(snapshot, now, calendar),
          ...(pending ? { pending } : {}),
          ...(quick ? { answered: true } : {}),
        },
        now,
      );
      // A mensagem é redesenhada primeiro; a planilha é gravada em seguida.
      persist(sendEffects(effects, props), snapshot, props.sheetId);
      cache.put(seenKey, '1', 21_600);
    });
  } catch (error) {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  }
  return ok;
}

/**
 * Acionador de tempo (a cada 5 minutos): lembretes das atividades, lembretes pessoais e o aviso
 * proativo do dia. Sem nada vencido, só lê a cópia em cache.
 */
export function processReminders(): void {
  const props = properties();
  withLock(() => {
    const now = new Date();
    const state = readState();
    const fresh = state && now.getTime() - Date.parse(state.builtAt) <= MAX_SNAPSHOT_AGE_MS;
    // Sem cópia recente, relê a planilha: isso também deixa o cache pronto para os botões.
    const built = fresh ? undefined : buildSnapshot(props.sheetId);
    const source = built ?? state!;
    const dueItems = source.reminders
      .map(reminderFromRow)
      .filter((reminder) => !reminder.sentAt && Date.parse(reminder.remindAt) <= now.getTime());
    const duePersonal = source.personal.some(
      (row) => !row[8] && Date.parse(row[3] ?? '') <= now.getTime(),
    );
    if (dueItems.length === 0 && !duePersonal) return;
    let snapshot = built ?? loadSnapshot(props.sheetId);
    if (duePersonal) {
      snapshot = persist(
        sendDuePersonalReminders({ props, snapshot, now }),
        snapshot,
        props.sheetId,
      );
    }
    if (dueItems.length > 0) {
      persist(
        sendEffects(dueReminders(dueItems, renderContextOf(snapshot, now), now), props),
        snapshot,
        props.sheetId,
      );
    }
  });
  try {
    const now = new Date();
    if (proactiveDue(now)) proactiveNudge({ props, snapshot: loadSnapshot(props.sheetId), now });
  } catch (error) {
    // O aviso do dia é um extra: uma falha aqui não afeta os lembretes acima.
    console.error(`Aviso proativo falhou: ${String(error)}`);
  }
  try {
    // Coleta no horário certo, sem depender do agendamento do GitHub (que atrasa horas).
    const now = new Date();
    const dispatch = scheduledDispatch(now);
    if (dispatch?.result === 'ok')
      console.log(`Coleta das ${dispatch.slot} disparada no GitHub Actions.`);
    if (dispatch?.result === 'rejected') {
      const notice = tokenProblemNotice(now);
      if (notice) sendHtml(props, notice);
    }
  } catch (error) {
    console.error(`Disparo da coleta falhou: ${String(error)}`);
  }
}

export { conversationInfo };

/** Relê a planilha e renova a cópia em cache; devolve um resumo para conferência no editor. */
export function refreshCache(): string {
  const props = properties();
  const started = Date.now();
  const snapshot = withLock(() => buildSnapshot(props.sheetId));
  const cached = readSnapshot();
  return JSON.stringify({
    cached: Boolean(cached && cached.items.length === snapshot.items.length),
    ms: Date.now() - started,
    items: snapshot.items.length,
    statuses: snapshot.statuses.length,
    reminders: snapshot.reminders.length,
    batches: snapshot.batches.length,
    personalReminders: snapshot.personal.length,
    memory: snapshot.memory.length,
    classes: snapshot.classes.length,
    files: snapshot.files.length,
    lastSyncAt: snapshot.lastSyncAt ?? null,
  });
}

/** Envia o painel (menu) para o chat; útil para testar o bot depois de publicar. */
export function sendPanel(): string {
  const props = properties();
  withLock(() => {
    const now = new Date();
    const snapshot = loadSnapshot(props.sheetId);
    const effects = handleUpdate(
      {
        update_id: 0,
        message: { message_id: 0, chat: { id: Number(props.chatId) }, text: '/painel' },
      },
      { chatId: props.chatId, context: renderContextOf(snapshot, now) },
      now,
    );
    persist(sendEffects(effects, props), snapshot, props.sheetId);
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
