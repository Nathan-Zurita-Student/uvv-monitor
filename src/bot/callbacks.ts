import type { ItemStatus } from '../models/academic-item.js';

export const viewNames = ['home', 'exams', 'tasks', 'late', 'nodate', 'cal', 'tomorrow'] as const;
export type ViewName = (typeof viewNames)[number];

export const cardContexts = ['new', 'date', 'changed', 'urgent', 'reminder'] as const;
export type CardContext = (typeof cardContexts)[number];

export const reminderOptions = ['30m', '1h', 'night', 'tomorrow', 'daybefore', 'custom'] as const;
export type ReminderOption = (typeof reminderOptions)[number];

/** Onde a mensagem está, para redesenhá-la igual depois de uma ação. */
export type Screen =
  | { kind: 'card'; context: CardContext }
  | { kind: 'pager'; batchId: string; index: number }
  | { kind: 'detail'; from: ViewName };

export type CallbackAction =
  /** undo: botão Desfazer logo após uma ação (muda só a frase de confirmação). */
  | { type: 'status'; itemId: string; status: ItemStatus; undo: boolean; screen: Screen }
  | { type: 'remindMenu'; itemId: string; screen: Screen }
  | { type: 'remind'; itemId: string; option: ReminderOption; screen: Screen }
  | { type: 'item'; itemId: string; screen: Screen }
  | { type: 'view'; view: ViewName; refresh: boolean }
  | { type: 'page'; batchId: string; index: number }
  | { type: 'noop' }
  | { type: 'legacy'; itemId: string; status: ItemStatus };

const statusCodes: Record<ItemStatus, string> = {
  TODO: 'T',
  IN_PROGRESS: 'P',
  DONE: 'D',
  WAITING: 'W',
  NEEDS_CONFIRMATION: 'N',
  IGNORED: 'I',
};
const statusByCode = Object.fromEntries(
  Object.entries(statusCodes).map(([status, code]) => [code, status as ItemStatus]),
) as Record<string, ItemStatus>;

const contextCodes: Record<CardContext, string> = {
  new: 'n',
  date: 'd',
  changed: 'c',
  urgent: 'u',
  reminder: 'r',
};
const contextByCode = Object.fromEntries(
  Object.entries(contextCodes).map(([context, code]) => [code, context as CardContext]),
) as Record<string, CardContext>;

function encodeScreen(screen: Screen): string {
  if (screen.kind === 'card') return `c.${contextCodes[screen.context]}`;
  if (screen.kind === 'pager') return `p.${screen.batchId}.${String(screen.index)}`;
  return `d.${screen.from}`;
}

function decodeScreen(value: string | undefined): Screen | undefined {
  const [kind, first, second] = (value ?? '').split('.');
  if (kind === 'c' && first && contextByCode[first]) {
    return { kind: 'card', context: contextByCode[first] };
  }
  if (
    kind === 'p' &&
    first &&
    /^[A-Za-z0-9]{4,12}$/.test(first) &&
    /^\d{1,3}$/.test(second ?? '')
  ) {
    return { kind: 'pager', batchId: first, index: Number(second) };
  }
  if (kind === 'd' && isView(first)) return { kind: 'detail', from: first };
  return undefined;
}

function isView(value: string | undefined): value is ViewName {
  return (viewNames as readonly string[]).includes(value ?? '');
}

const itemIdPattern = /^UVV-[A-Z0-9]{4,10}$/;

export function encodeCallback(action: CallbackAction): string {
  let value: string;
  switch (action.type) {
    case 'status':
      value = `s|${action.itemId}|${statusCodes[action.status]}${action.undo ? 'u' : ''}|${encodeScreen(action.screen)}`;
      break;
    case 'remindMenu':
      value = `r|${action.itemId}||${encodeScreen(action.screen)}`;
      break;
    case 'remind':
      value = `rs|${action.itemId}|${action.option}|${encodeScreen(action.screen)}`;
      break;
    case 'item':
      value = `i|${action.itemId}||${encodeScreen(action.screen)}`;
      break;
    case 'view':
      value = `v|${action.view}|${action.refresh ? '1' : ''}`;
      break;
    case 'page':
      value = `p|${action.batchId}|${String(action.index)}`;
      break;
    case 'noop':
      value = 'x';
      break;
    case 'legacy':
      value = `task:${action.itemId}:${action.status}`;
      break;
  }
  // Todos os campos são ASCII, então caracteres = bytes.
  if (value.length > 64) {
    throw new Error('callback_data excede o limite de 64 bytes do Telegram.');
  }
  return value;
}

const legacyStatuses: Record<string, ItemStatus> = {
  not_started: 'TODO',
  in_progress: 'IN_PROGRESS',
  completed: 'DONE',
  waiting: 'WAITING',
};

export function decodeCallback(data: string): CallbackAction | undefined {
  const legacy = /^task:(UVV-[A-Z0-9]{4,10}):(not_started|in_progress|completed|waiting)$/i.exec(
    data.trim(),
  );
  if (legacy?.[1] && legacy[2]) {
    const status = legacyStatuses[legacy[2].toLowerCase()];
    return status ? { type: 'legacy', itemId: legacy[1].toUpperCase(), status } : undefined;
  }
  if (data === 'x') return { type: 'noop' };
  const [code, first = '', second = '', third] = data.split('|');
  if (code === 'v' && isView(first)) return { type: 'view', view: first, refresh: second === '1' };
  if (code === 'p' && /^[A-Za-z0-9]{4,12}$/.test(first) && /^-?\d{1,3}$/.test(second)) {
    return { type: 'page', batchId: first, index: Number(second) };
  }
  if (!itemIdPattern.test(first)) return undefined;
  const screen = decodeScreen(third);
  if (!screen) return undefined;
  if (code === 's') {
    const status = statusByCode[second.charAt(0)];
    if (!status) return undefined;
    return { type: 'status', itemId: first, status, undo: second.charAt(1) === 'u', screen };
  }
  if (code === 'r') return { type: 'remindMenu', itemId: first, screen };
  if (code === 'rs' && (reminderOptions as readonly string[]).includes(second)) {
    return { type: 'remind', itemId: first, option: second as ReminderOption, screen };
  }
  if (code === 'i') return { type: 'item', itemId: first, screen };
  return undefined;
}
