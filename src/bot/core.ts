import { buildAgenda } from '../agenda/agenda.js';
import type { AcademicItem, ItemStatus, UserTaskStatus } from '../models/academic-item.js';
import type { Reminder } from '../models/bot.js';
import type { TelegramCallbackQuery, TelegramMessage, TelegramUpdate } from '../telegram/types.js';
import { itemLabel } from './activity.js';
import { decodeCallback, type CallbackAction, type Screen, type ViewName } from './callbacks.js';
import { phrases, pick } from './phrases.js';
import { describeReminder, parseReminderText, reminderTime } from './reminders.js';
import {
  entryFor,
  helpText,
  reminderKeyboard,
  renderItemScreen,
  renderPage,
  renderView,
  type Keyboard,
  type RenderContext,
} from './screens.js';
import { userStatusRecord } from './status.js';
import { escapeHtml } from '../telegram/html.js';

/** Pedido de horário livre ("Escolher horário") aguardando a resposta do usuário. */
export interface PendingInput {
  itemId: string;
  screen: Screen;
  messageId?: number;
}

export type BotEffect =
  | { type: 'answer'; callbackId: string; text?: string }
  | { type: 'edit'; messageId: number; text: string; keyboard: Keyboard }
  | { type: 'editKeyboard'; messageId: number; keyboard: Keyboard }
  | { type: 'send'; text: string; keyboard?: Keyboard; forceReply?: boolean }
  | { type: 'setStatus'; record: UserTaskStatus }
  | { type: 'setReminder'; reminder: Reminder }
  | { type: 'setPending'; pending: PendingInput | undefined };

export interface BotInput {
  chatId: string;
  context: RenderContext;
  pending?: PendingInput;
  /** O toque já foi respondido por `quickAnswer`: não responde de novo. */
  answered?: boolean;
}

/** Os botões de status são Concluir, Ignorar, Reabrir (volta a TODO) e Desfazer. */
function statusPhrase(itemId: string, to: ItemStatus, undo: boolean): string {
  const seed = `${itemId}:${to}`;
  if (undo) return pick(phrases.undone, seed);
  if (to === 'DONE') return pick(phrases.done, seed);
  if (to === 'IGNORED') return pick(phrases.ignored, seed);
  if (to === 'TODO') return pick(phrases.reopened, seed);
  return '👍 Atualizado.';
}

const remindMenuText = 'Quando eu te lembro?';
const customReminderText = 'Me diga o horário 👇';

/** Aviso do toque que só depende do botão; `undefined` quando depende dos dados. */
function instantText(action: CallbackAction): string | undefined {
  switch (action.type) {
    case 'noop':
    case 'page':
    case 'item':
      return '';
    case 'view':
      return action.refresh ? undefined : '';
    case 'status':
      return statusPhrase(action.itemId, action.status, action.undo);
    case 'remindMenu':
      return remindMenuText;
    case 'remind':
      return action.option === 'custom' ? customReminderText : undefined;
    case 'legacy':
      return undefined;
  }
}

/**
 * Resposta ao toque que não precisa da planilha. O webhook a envia antes de carregar os dados,
 * então o botão para de "carregar" na hora e o aviso aparece enquanto a mensagem é redesenhada.
 */
export function quickAnswer(
  update: TelegramUpdate,
  chatId: string,
): Extract<BotEffect, { type: 'answer' }> | undefined {
  const callback = update.callback_query;
  if (!callback || String(callback.message?.chat.id ?? '') !== chatId) return undefined;
  const action = decodeCallback(callback.data ?? '');
  const text = action ? instantText(action) : undefined;
  if (text === undefined) return undefined;
  return { type: 'answer', callbackId: callback.id, ...(text ? { text } : {}) };
}

/** Atividades e lotes que o update precisa encontrar (para saber se a cópia em cache serve). */
export function referencedData(
  update: TelegramUpdate,
  pending?: PendingInput,
): { itemIds: string[]; batchIds: string[] } {
  const itemIds: string[] = [];
  const batchIds: string[] = [];
  const addScreen = (screen: Screen) => {
    if (screen.kind === 'pager') batchIds.push(screen.batchId);
  };
  const action = update.callback_query
    ? decodeCallback(update.callback_query.data ?? '')
    : undefined;
  if (action) {
    if ('itemId' in action) itemIds.push(action.itemId);
    if ('screen' in action) addScreen(action.screen);
    if (action.type === 'page') batchIds.push(action.batchId);
  } else if (update.message && pending) {
    itemIds.push(pending.itemId);
    addScreen(pending.screen);
  }
  return { itemIds, batchIds };
}

function withStatus(context: RenderContext, item: AcademicItem, status: ItemStatus): RenderContext {
  const items = context.items.map((candidate) =>
    candidate.id === item.id ? { ...candidate, status } : candidate,
  );
  // A agenda depende do status (concluídos saem das listas), então é recalculada.
  return { ...context, items, agenda: buildAgenda(items, context.now) };
}

function withReminder(context: RenderContext, reminder: Reminder): RenderContext {
  return {
    ...context,
    reminderFor: (itemId) => (itemId === reminder.itemId ? reminder : context.reminderFor(itemId)),
  };
}

function handleCallback(
  callback: TelegramCallbackQuery,
  action: CallbackAction,
  input: BotInput,
  now: Date,
): BotEffect[] {
  const message = callback.message;
  const messageId = message?.message_id ?? 0;
  const { context } = input;
  const answer = (text?: string): BotEffect => ({
    type: 'answer',
    callbackId: callback.id,
    ...(text ? { text } : {}),
  });
  const findItem = (itemId: string) => context.items.find((item) => item.id === itemId);

  switch (action.type) {
    case 'noop':
      return [answer()];
    case 'view': {
      const rendered = renderView(context, action.view);
      const updated = context.lastSyncAt
        ? `🔄 Atualizado (última verificação às ${new Date(context.lastSyncAt).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })})`
        : '🔄 Atualizado';
      return [
        answer(action.refresh ? updated : undefined),
        { type: 'edit', messageId, text: rendered.text, keyboard: rendered.keyboard },
      ];
    }
    case 'page': {
      const rendered = renderPage(context, action.batchId, action.index);
      return [answer(), { type: 'edit', messageId, ...rendered }];
    }
    case 'legacy':
    case 'status': {
      const screen: Screen =
        action.type === 'status' ? action.screen : { kind: 'card', context: 'new' };
      const item = findItem(action.itemId);
      if (!item) return [answer('Essa atividade não está mais na lista.')];
      const undo = action.type === 'status' && action.undo;
      const record = userStatusRecord(item.id, action.status, item.status, now.toISOString());
      const updatedContext = withStatus(context, item, action.status);
      const updatedItem =
        updatedContext.items.find((candidate) => candidate.id === item.id) ?? item;
      const rendered = renderItemScreen(updatedContext, updatedItem, screen, {
        // Depois de concluir/ignorar, oferece desfazer voltando ao status anterior.
        ...(!undo && item.status !== action.status ? { undoTo: item.status } : {}),
      });
      return [
        { type: 'setStatus', record },
        answer(statusPhrase(item.id, action.status, undo)),
        { type: 'edit', messageId, ...rendered },
      ];
    }
    case 'remindMenu': {
      const item = findItem(action.itemId);
      if (!item) return [answer('Essa atividade não está mais na lista.')];
      return [
        answer(remindMenuText),
        {
          type: 'editKeyboard',
          messageId,
          keyboard: reminderKeyboard(context, entryFor(context, item), item.id, action.screen),
        },
      ];
    }
    case 'remind': {
      const item = findItem(action.itemId);
      if (!item) return [answer('Essa atividade não está mais na lista.')];
      if (action.option === 'custom') {
        return [
          answer(customReminderText),
          {
            type: 'send',
            text: `🕒 Quando eu te lembro de <b>${escapeHtml(itemLabel(item))}</b>?\nPode responder assim: <i>18:30</i>, <i>amanhã 9h</i>, <i>15/10 14h</i> ou <i>em 2 horas</i>.`,
            forceReply: true,
          },
          { type: 'setPending', pending: { itemId: item.id, screen: action.screen, messageId } },
        ];
      }
      const at = reminderTime(action.option, entryFor(context, item), now);
      if (!at) return [answer('Esse horário já passou. Escolha outro.')];
      const reminder: Reminder = {
        itemId: item.id,
        remindAt: at.toISOString(),
        createdAt: now.toISOString(),
        chatId: input.chatId,
      };
      const rendered = renderItemScreen(withReminder(context, reminder), item, action.screen);
      return [
        { type: 'setReminder', reminder },
        answer(`⏰ Combinado! Te lembro ${describeReminder(at, now)}.`),
        { type: 'edit', messageId, ...rendered },
      ];
    }
    case 'item': {
      const item = findItem(action.itemId);
      if (!item) return [answer('Essa atividade não está mais na lista.')];
      return [
        answer(),
        { type: 'edit', messageId, ...renderItemScreen(context, item, action.screen) },
      ];
    }
  }
}

const commandViews: Record<string, ViewName> = {
  painel: 'home',
  inicio: 'home',
  provas: 'exams',
  atividades: 'tasks',
  atrasadas: 'late',
  semdata: 'nodate',
  calendario: 'cal',
  amanha: 'tomorrow',
};

function handleMessage(message: TelegramMessage, input: BotInput, now: Date): BotEffect[] {
  const text = (message.text ?? '').trim();
  const command = /^\/([a-zçãáé]+)(?:@\w+)?/i
    .exec(text)?.[1]
    ?.normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

  if (!command && input.pending) {
    const at = parseReminderText(text, now);
    const item = input.context.items.find((candidate) => candidate.id === input.pending?.itemId);
    if (!item) return [{ type: 'setPending', pending: undefined }];
    if (!at) {
      return [
        {
          type: 'send',
          text: 'Não entendi o horário 😅 Tenta assim: <i>18:30</i>, <i>amanhã 9h</i>, <i>15/10 14h</i> ou <i>em 2 horas</i>.',
          forceReply: true,
        },
      ];
    }
    const reminder: Reminder = {
      itemId: item.id,
      remindAt: at.toISOString(),
      createdAt: now.toISOString(),
      chatId: input.chatId,
    };
    const effects: BotEffect[] = [
      { type: 'setReminder', reminder },
      { type: 'setPending', pending: undefined },
      {
        type: 'send',
        text: `⏰ Combinado! Te lembro de <b>${escapeHtml(itemLabel(item))}</b> ${describeReminder(at, now)}.`,
      },
    ];
    if (input.pending.messageId) {
      const rendered = renderItemScreen(
        withReminder(input.context, reminder),
        item,
        input.pending.screen,
      );
      effects.push({ type: 'edit', messageId: input.pending.messageId, ...rendered });
    }
    return effects;
  }

  if (command === 'start' || command === 'ajuda' || command === 'help') {
    const home = renderView(input.context, 'home');
    return [
      { type: 'send', text: helpText() },
      { type: 'send', text: home.text, keyboard: home.keyboard },
    ];
  }
  const view = command ? commandViews[command] : undefined;
  if (view) {
    const rendered = renderView(input.context, view);
    return [
      ...(input.pending ? [{ type: 'setPending', pending: undefined } as const] : []),
      { type: 'send', text: rendered.text, keyboard: rendered.keyboard },
    ];
  }
  return [{ type: 'send', text: 'Use /painel para ver suas provas e atividades. 🙂' }];
}

/** Processa um update do Telegram e devolve as ações a executar (sem efeitos colaterais). */
export function handleUpdate(update: TelegramUpdate, input: BotInput, now: Date): BotEffect[] {
  const callback = update.callback_query;
  if (callback) {
    if (String(callback.message?.chat.id ?? '') !== input.chatId) {
      return [{ type: 'answer', callbackId: callback.id, text: 'Esse botão não é seu.' }];
    }
    const action = decodeCallback(callback.data ?? '');
    if (!action) {
      return [
        { type: 'answer', callbackId: callback.id, text: 'Esse botão é de uma versão antiga.' },
      ];
    }
    const effects = handleCallback(callback, action, input, now);
    return input.answered ? effects.filter((effect) => effect.type !== 'answer') : effects;
  }
  const message = update.message;
  if (!message?.text || String(message.chat.id) !== input.chatId) return [];
  return handleMessage(message, input, now);
}

/** Lembretes vencidos: envia o cartão de lembrete e marca como enviado. */
export function dueReminders(
  reminders: Reminder[],
  context: RenderContext,
  now: Date,
): BotEffect[] {
  return reminders.flatMap((reminder) => {
    if (reminder.sentAt || new Date(reminder.remindAt).getTime() > now.getTime()) return [];
    const item = context.items.find((candidate) => candidate.id === reminder.itemId);
    const sent: BotEffect = {
      type: 'setReminder',
      reminder: { ...reminder, sentAt: now.toISOString() },
    };
    if (!item || item.status === 'DONE' || item.status === 'IGNORED') return [sent];
    const rendered = renderItemScreen(context, item, { kind: 'card', context: 'reminder' });
    return [sent, { type: 'send', text: rendered.text, keyboard: rendered.keyboard }];
  });
}
