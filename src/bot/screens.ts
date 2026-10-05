import {
  buildAgenda,
  findEntry,
  toAgendaEntry,
  type Agenda,
  type AgendaEntry,
} from '../agenda/agenda.js';
import { displayTitle, isAiIrrelevant } from '../agenda/focus.js';
import type { CalendarEvent, MemoryFact, PersonalReminder } from '../assistant/types.js';
import type { AcademicItem, ItemStatus } from '../models/academic-item.js';
import type { NotificationReason, Reminder, TelegramBatch } from '../models/bot.js';
import type { ClassSlot } from '../models/class-schedule.js';
import type { PortalDocument } from '../models/portal-document.js';
import type { TelegramButton } from '../telegram/client.js';
import { escapeHtml, italic, truncate } from '../telegram/html.js';
import { hasExplicitTime } from '../utils/dates.js';
import {
  activityFacts,
  clock,
  countdownLine,
  dayMonth,
  itemLabel,
  naturalSentence,
  shortDiscipline,
  studyTopics,
  weekdayName,
  whenText,
} from './activity.js';
import { encodeCallback, type CardContext, type Screen, type ViewName } from './callbacks.js';
import { phrases, pick } from './phrases.js';
import { priorityOf } from './priority.js';
import { describeReminder, reminderChoices } from './reminders.js';
import { OVERDUE_LABEL, isOpenStatus, statusLabels } from './status.js';

export type Keyboard = TelegramButton[][];

export interface Rendered {
  text: string;
  keyboard: Keyboard;
}

/**
 * Agenda pessoal usada nas telas Hoje/Semana. O Apps Script preenche; sem ela (monitor no Node),
 * as telas mostram só o que veio do Portal, AVA e e-mails.
 */
export interface ScheduleData {
  events?: CalendarEvent[];
  calendarError?: boolean;
  memory?: MemoryFact[];
  personalReminders?: PersonalReminder[];
  /** Quadro de Horários do Portal. */
  classes?: ClassSlot[];
}

/** Tudo que as telas precisam saber, montado uma vez por atualização. */
export interface RenderContext {
  now: Date;
  items: AcademicItem[];
  agenda: Agenda;
  reminderFor(itemId: string): Reminder | undefined;
  batch(batchId: string): TelegramBatch | undefined;
  lastSyncAt?: string;
  schedule?: ScheduleData;
  /** Arquivos dos posts dos professores (sem o texto), para a tela de materiais. */
  materials?: PortalDocument[];
}

export function createRenderContext(input: {
  now: Date;
  items: AcademicItem[];
  reminders?: Reminder[];
  batches?: TelegramBatch[];
  lastSyncAt?: string;
  schedule?: ScheduleData;
  materials?: PortalDocument[];
}): RenderContext {
  const reminders = new Map((input.reminders ?? []).map((reminder) => [reminder.itemId, reminder]));
  const batches = new Map((input.batches ?? []).map((batch) => [batch.batchId, batch]));
  return {
    now: input.now,
    items: input.items,
    agenda: buildAgenda(input.items, input.now),
    reminderFor: (itemId) => reminders.get(itemId),
    batch: (batchId) => batches.get(batchId),
    ...(input.lastSyncAt ? { lastSyncAt: input.lastSyncAt } : {}),
    ...(input.schedule ? { schedule: input.schedule } : {}),
    ...(input.materials ? { materials: input.materials } : {}),
  };
}

/**
 * Entrada da agenda de um item, inclusive quando ele está concluído/ignorado (fora da agenda),
 * para que o cartão continue mostrando prazo e pontos depois de uma ação.
 */
export function entryFor(context: RenderContext, item: AcademicItem): AgendaEntry | undefined {
  const fromAgenda = findEntry(context.agenda, item.id);
  if (fromAgenda) return fromAgenda.item.id === item.id ? fromAgenda : { ...fromAgenda, item };
  if (isOpenStatus(item.status)) return toAgendaEntry(item, context.now);
  const reopened = { ...item, status: 'TODO' as const };
  const agenda = buildAgenda(
    context.items.map((candidate) => (candidate.id === item.id ? reopened : candidate)),
    context.now,
  );
  const entry = findEntry(agenda, item.id) ?? toAgendaEntry(reopened, context.now);
  return entry ? { ...entry, item: entry.item.id === item.id ? item : entry.item } : undefined;
}

// ---------------------------------------------------------------------------------------------
// Pedaços de texto

export function relativeDue(entry: AgendaEntry, now: Date): string {
  const days = entry.days ?? 0;
  if (entry.kind === 'TASK' && entry.due && entry.due.getTime() < now.getTime()) {
    if (days === 0) return 'venceu hoje';
    return days === -1 ? 'venceu ontem' : `venceu há ${String(-days)} dias`;
  }
  if (days === 0) return 'hoje';
  if (days === 1) return 'amanhã';
  return `faltam ${String(days)} dias`;
}

export function shortDate(entry: AgendaEntry): string {
  return entry.date ? whenText(entry.date.value, entry.date.deadline || entry.kind === 'TASK') : '';
}

function isOverdue(entry: AgendaEntry, now: Date): boolean {
  return entry.kind === 'TASK' && Boolean(entry.due) && (entry.due?.getTime() ?? 0) < now.getTime();
}

function statusLine(entry: AgendaEntry, now: Date): string {
  if (isOpenStatus(entry.item.status) && isOverdue(entry, now)) return OVERDUE_LABEL;
  return statusLabels[entry.item.status];
}

function reminderLine(context: RenderContext, itemId: string): string | undefined {
  const reminder = context.reminderFor(itemId);
  if (!reminder || reminder.sentAt) return undefined;
  const at = new Date(reminder.remindAt);
  if (Number.isNaN(at.getTime()) || at.getTime() < context.now.getTime()) return undefined;
  return `⏰ Lembrete marcado: ${describeReminder(at, context.now)}`;
}

function aiSummary(item: AcademicItem, maxLength = 220): string | undefined {
  const summary = item.metadata?.aiSummary?.trim();
  return summary ? truncate(summary, maxLength) : undefined;
}

/** Itens do AVA e provas têm frase montada com fatos; o resto usa o resumo da IA. */
function mainSentence(entry: AgendaEntry, now: Date): { text: string; mentionsDate: boolean } {
  const summary = aiSummary(entry.item);
  if (entry.kind === 'EXAM' || entry.item.metadata?.moodleModule || !summary) {
    return { text: naturalSentence(entry, now), mentionsDate: Boolean(entry.date) };
  }
  return { text: summary, mentionsDate: false };
}

function headline(
  entry: AgendaEntry,
  context: CardContext,
  now: Date,
): {
  text: string;
  conveysDeadline: boolean;
} {
  const seed = `${entry.item.id}:${context}`;
  if (context === 'reminder') return { text: pick(phrases.reminder, seed), conveysDeadline: false };
  if (context === 'date') return { text: pick(phrases.changedDate, seed), conveysDeadline: false };
  if (context === 'changed') return { text: pick(phrases.updated, seed), conveysDeadline: false };
  const name = truncate(displayTitle(entry.item), 45);
  const time =
    entry.due && hasExplicitTime(entry.date?.value ?? '') ? ` às ${clock(entry.due)}` : '';
  const days = entry.days ?? 99;
  const priority = priorityOf(entry, now);
  if (entry.kind === 'TASK') {
    if (isOverdue(entry, now)) {
      return {
        text: `🔴 ${name} ${relativeDue(entry, now)}${days === 0 ? time : ''}.`,
        conveysDeadline: true,
      };
    }
    if (priority === 'critical')
      return { text: `🚨 ${name} vence hoje${time}.`, conveysDeadline: true };
    if (priority === 'high') {
      return {
        text:
          days === 1
            ? `⚠️ ${name} vence amanhã${time}.`
            : `⚠️ ${name} vence em ${String(days)} dias.`,
        conveysDeadline: true,
      };
    }
    return {
      text: context === 'urgent' ? pick(phrases.soon, seed) : pick(phrases.newActivity, seed),
      conveysDeadline: false,
    };
  }
  const subject = shortDiscipline(entry.item.discipline);
  const exam = subject ? `Sua prova de ${subject}` : 'Sua prova';
  if (priority === 'critical') return { text: `🚨 ${exam} é hoje${time}.`, conveysDeadline: true };
  if (priority === 'high') {
    return {
      text:
        days === 1 ? `⚠️ ${exam} é amanhã${time}.` : `⚠️ ${exam} é daqui a ${String(days)} dias.`,
      conveysDeadline: true,
    };
  }
  return { text: pick(phrases.newExam, seed), conveysDeadline: false };
}

// ---------------------------------------------------------------------------------------------
// Cartões

/** Aviso curto enviado de forma proativa (novidade, prazo, lembrete). */
export function renderCardText(
  context: RenderContext,
  entry: AgendaEntry,
  cardContext: CardContext,
  previousDue?: string,
): string {
  const { now } = context;
  const facts = activityFacts(entry);
  const top = headline(entry, cardContext, now);
  const lines = [escapeHtml(top.text), '', `${facts.icon} <b>${escapeHtml(facts.label)}</b>`];
  const sentence = mainSentence(entry, now);
  lines.push(escapeHtml(sentence.text));
  if (!top.conveysDeadline) {
    const countdown = countdownLine(entry, now);
    if (countdown) {
      lines.push(
        sentence.mentionsDate || !entry.date
          ? countdown
          : `📅 ${escapeHtml(shortDate(entry))} · ${relativeDue(entry, now)}`,
      );
    }
  }
  if (cardContext === 'date' && previousDue) {
    lines.push(`Antes era ${escapeHtml(whenText(previousDue, entry.kind === 'TASK'))}.`);
  }
  const topics = studyTopics(entry);
  if (entry.kind === 'EXAM' && topics.length > 0) {
    lines.push(`📖 Vai cair: ${escapeHtml(truncate(topics.join('; '), 180))}`);
  }
  if (facts.tip && (cardContext === 'new' || cardContext === 'reminder')) {
    lines.push(escapeHtml(facts.tip));
  }
  const reminder = reminderLine(context, entry.item.id);
  if (reminder) lines.push(escapeHtml(reminder));
  if (entry.item.status !== 'TODO') lines.push(statusLine(entry, now));
  return lines.join('\n');
}

/** Visão completa de uma atividade: disponível, entrega, pontos, conteúdo e status. */
export function renderDetailText(
  context: RenderContext,
  entry: AgendaEntry,
  header?: string,
): string {
  const { now } = context;
  const facts = activityFacts(entry);
  const lines = header ? [header, ''] : [];
  lines.push(`${facts.icon} <b>${escapeHtml(facts.label)}</b>`);
  const summary = entry.item.metadata?.moodleModule ? undefined : aiSummary(entry.item, 180);
  if (summary) lines.push(escapeHtml(summary));
  if (facts.opensAt) lines.push(`🟢 Disponível: ${dayMonth(facts.opensAt)}`);
  if (!entry.date) {
    lines.push('📅 Data ainda não definida');
  } else if (entry.kind === 'EXAM' && entry.due) {
    lines.push(
      `📅 Data: ${weekdayName(entry.due)}, ${escapeHtml(shortDate(entry))} · ${relativeDue(entry, now)}`,
    );
  } else {
    lines.push(`🔴 Entrega: ${escapeHtml(shortDate(entry))} · ${relativeDue(entry, now)}`);
  }
  if (facts.points)
    lines.push(`⭐ Vale: ${facts.points} ${facts.points === '1' ? 'ponto' : 'pontos'}`);
  const topics = studyTopics(entry);
  if (entry.kind === 'EXAM' && topics.length > 0) {
    lines.push(`📖 Vai cair: ${escapeHtml(truncate(topics.join('; '), 180))}`);
  }
  const reminder = reminderLine(context, entry.item.id);
  if (reminder) lines.push(escapeHtml(reminder));
  lines.push(statusLine(entry, now));
  return lines.join('\n');
}

/** Comunicado sem ação: título, disciplina e um resumo curto. */
export function renderNoticeText(item: AcademicItem, header?: string): string {
  const lines = header ? [header, ''] : [];
  const discipline = shortDiscipline(item.discipline);
  lines.push(`📌 <b>${escapeHtml(truncate(displayTitle(item), 90))}</b>`);
  if (discipline) lines.push(italic(discipline));
  lines.push(escapeHtml(aiSummary(item, 280) ?? truncate(item.description, 280)));
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------
// Teclados

function openButton(item: AcademicItem, label: string): TelegramButton[] {
  return /^https:\/\//i.test(item.sourceUrl) ? [{ text: label, url: item.sourceUrl }] : [];
}

/** Ações da atividade conforme o status; `undoTo` mostra "Desfazer" logo após uma ação. */
export function actionRows(entry: AgendaEntry, screen: Screen, undoTo?: ItemStatus): Keyboard {
  const { item } = entry;
  const facts = activityFacts(entry);
  const open = openButton(item, facts.openLabel);
  const status = (target: ItemStatus, undo = false) =>
    encodeCallback({ type: 'status', itemId: item.id, status: target, undo, screen });
  if (undoTo && !isOpenStatus(item.status)) {
    return [[{ text: '↩️ Desfazer', callback_data: status(undoTo, true) }, ...open]];
  }
  if (item.status === 'DONE' || item.status === 'IGNORED') {
    return [[{ text: '↩️ Reabrir', callback_data: status('TODO') }, ...open]];
  }
  return [
    [
      { text: '✅ Concluir', callback_data: status('DONE') },
      {
        text: '⏰ Lembrar',
        callback_data: encodeCallback({ type: 'remindMenu', itemId: item.id, screen }),
      },
    ],
    [...open, { text: '🙈 Ignorar', callback_data: status('IGNORED') }],
  ];
}

export function reminderKeyboard(
  context: RenderContext,
  entry: AgendaEntry | undefined,
  itemId: string,
  screen: Screen,
): Keyboard {
  const buttons = reminderChoices(entry, context.now).map(({ option, label }) => ({
    text: label,
    callback_data: encodeCallback({ type: 'remind', itemId, option, screen }),
  }));
  const rows: Keyboard = [];
  for (let index = 0; index < buttons.length; index += 2)
    rows.push(buttons.slice(index, index + 2));
  rows.push([
    { text: '↩️ Voltar', callback_data: encodeCallback({ type: 'item', itemId, screen }) },
  ]);
  return rows;
}

export const viewButton = (text: string, view: ViewName, refresh = false): TelegramButton => ({
  text,
  callback_data: encodeCallback({ type: 'view', view, refresh }),
});

export const backToHome: TelegramButton[] = [viewButton('⬅️ Voltar', 'home')];

// ---------------------------------------------------------------------------------------------
// Tela de um item (cartão, página de novidades ou detalhe aberto pelo painel)

const reasonTags: Record<NotificationReason, string> = {
  new: 'nova',
  date: 'prazo alterado',
  changed: 'atualização',
  urgent: 'prazo chegando',
  notice: 'aviso',
};

export function renderItemScreen(
  context: RenderContext,
  item: AcademicItem,
  screen: Screen,
  options: { undoTo?: ItemStatus; previousDue?: string } = {},
): Rendered {
  const entry = entryFor(context, item);
  if (screen.kind === 'pager') return renderPage(context, screen.batchId, screen.index, options);
  if (!entry) {
    return {
      text: renderNoticeText(item),
      keyboard: [
        openButton(item, '📖 Abrir'),
        ...(screen.kind === 'detail' ? [[viewButton('⬅️ Voltar', screen.from)]] : []),
      ].filter((row) => row.length > 0),
    };
  }
  if (screen.kind === 'card') {
    return {
      text: renderCardText(context, entry, screen.context, options.previousDue),
      keyboard: actionRows(entry, screen, options.undoTo),
    };
  }
  return {
    text: renderDetailText(context, entry),
    keyboard: [
      ...actionRows(entry, screen, options.undoTo),
      [viewButton('⬅️ Voltar', screen.from)],
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// Resumo de novidades e navegação ⬅️ 1/3 ➡️

export function plural(count: number, singular: string, pluralForm: string): string {
  return `${String(count)} ${count === 1 ? singular : pluralForm}`;
}

export function renderSummary(context: RenderContext, batch: TelegramBatch): Rendered {
  const items = new Map(context.items.map((item) => [item.id, item]));
  const resolved = batch.entries.flatMap(({ itemId, reason }) => {
    const item = items.get(itemId);
    return item ? [{ item, reason, entry: entryFor(context, item) }] : [];
  });
  const count = (predicate: (value: (typeof resolved)[number]) => boolean) =>
    resolved.filter(predicate).length;
  const newExams = count(({ reason, entry }) => reason === 'new' && entry?.kind === 'EXAM');
  const newTasks = count(({ reason, entry }) => reason === 'new' && entry?.kind === 'TASK');
  const lines = ['👀 <b>Encontrei algumas novidades na UVV</b>', ''];
  if (newTasks > 0) lines.push(`• ${plural(newTasks, 'atividade nova', 'atividades novas')}`);
  lines.push(
    newExams > 0 ? `• ${plural(newExams, 'prova nova', 'provas novas')}` : '• nenhuma prova nova',
  );
  const dates = count(({ reason }) => reason === 'date');
  if (dates > 0) lines.push(`• ${plural(dates, 'prazo alterado', 'prazos alterados')}`);
  const updates = count(({ reason }) => reason === 'changed');
  if (updates > 0) lines.push(`• ${plural(updates, 'atualização', 'atualizações')}`);
  const urgent = count(({ reason }) => reason === 'urgent');
  if (urgent > 0) lines.push(`• ${plural(urgent, 'prazo chegando', 'prazos chegando')}`);
  const notices = count(({ reason }) => reason === 'notice');
  if (notices > 0) lines.push(`• ${plural(notices, 'aviso novo', 'avisos novos')}`);
  const nearest = resolved
    .flatMap(({ entry }) =>
      entry?.due && entry.days !== undefined && entry.days >= 0 ? [entry] : [],
    )
    .sort((left, right) => (left.due?.getTime() ?? 0) - (right.due?.getTime() ?? 0))[0];
  if (nearest) {
    const when = dayMonth(nearest.due ?? context.now);
    lines.push(
      '',
      nearest.kind === 'EXAM'
        ? `A mais próxima é a <b>${escapeHtml(itemLabel(nearest.item))}</b>, em ${when}.`
        : `A mais próxima é <b>${escapeHtml(itemLabel(nearest.item))}</b>, com entrega em ${when}.`,
    );
  }
  return {
    text: lines.join('\n'),
    keyboard: [
      [
        {
          text: '📋 Ver novidades',
          callback_data: encodeCallback({ type: 'page', batchId: batch.batchId, index: 0 }),
        },
      ],
    ],
  };
}

export function renderPage(
  context: RenderContext,
  batchId: string,
  index: number,
  options: { undoTo?: ItemStatus } = {},
): Rendered {
  const batch = context.batch(batchId);
  if (!batch || batch.entries.length === 0) {
    return {
      text: 'Essas novidades já não estão disponíveis. Use /painel para ver tudo.',
      keyboard: [backToHome],
    };
  }
  if (index < 0) return renderSummary(context, batch);
  const position = Math.min(index, batch.entries.length - 1);
  const current = batch.entries[position];
  const item = context.items.find((candidate) => candidate.id === current?.itemId);
  const total = batch.entries.length;
  const header = `👀 <b>Novidade ${String(position + 1)} de ${String(total)}</b> · ${current ? reasonTags[current.reason] : ''}`;
  const page = (target: number) => encodeCallback({ type: 'page', batchId, index: target });
  const navigation: Keyboard = [
    [
      position > 0
        ? { text: '⬅️', callback_data: page(position - 1) }
        : { text: '·', callback_data: 'x' },
      { text: `${String(position + 1)}/${String(total)}`, callback_data: 'x' },
      position < total - 1
        ? { text: '➡️', callback_data: page(position + 1) }
        : { text: '·', callback_data: 'x' },
    ],
    [{ text: '📋 Voltar ao resumo', callback_data: page(-1) }],
  ];
  if (!item) {
    return { text: `${header}\n\nEsse item não está mais disponível.`, keyboard: navigation };
  }
  const screen: Screen = { kind: 'pager', batchId, index: position };
  const entry = entryFor(context, item);
  if (!entry || isAiIrrelevant(item)) {
    return {
      text: renderNoticeText(item, header),
      keyboard: [openButton(item, '📖 Abrir'), ...navigation].filter((row) => row.length > 0),
    };
  }
  return {
    text: renderDetailText(context, entry, header),
    keyboard: [...actionRows(entry, screen, options.undoTo), ...navigation],
  };
}

export function helpText(): string {
  return [
    '🎓 <b>Seu assistente da UVV</b>',
    '',
    'Pode conversar comigo normalmente, como com uma pessoa: “como tá minha semana?”, “tenho prova sexta?”, “o que eu faço hoje?”, “organiza meus estudos”, “me lembra da AOP amanhã às 19h”, “me manda o PDF da unidade 3”.',
    '',
    'Eu acompanho o Portal (quadro de horários, murais das matérias e arquivos dos professores), o AVA, seus e-mails e sua Google Agenda, e te aviso do que importa. Os arquivos que os professores postam chegam aqui no chat.',
    '',
    '• Atalhos: /hoje /semana /provas /atividades /prazos /agenda /novidades /materiais /painel',
    '• /atualizar verifica o Portal, o AVA e seus e-mails na hora (além das verificações das 12h, 17h e 21h)',
    '• Nos avisos, use os botões pra concluir, lembrar depois ou ignorar',
    '• /gastos mostra o consumo do GPT; /esquecer limpa o contexto da conversa',
  ].join('\n');
}
