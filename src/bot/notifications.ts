import type { Agenda, AgendaEntry } from '../agenda/agenda.js';
import { focusKind, isAiIrrelevant, isOpen, originOf } from '../agenda/focus.js';
import type { AcademicItem } from '../models/academic-item.js';
import type { NotificationLogEntry, NotificationReason, NotifiedLevel } from '../models/bot.js';
import { alertLevel, isEscalation } from './priority.js';

function fnv(value: string): string {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return (result >>> 0).toString(16).padStart(8, '0');
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Origens em que mudança no texto significa atualização do professor. */
const editableOrigins = new Set(['CLASS_POST', 'MESSAGE', 'GMAIL']);

/**
 * Assinatura "prazo#hash". O prazo fica legível para saber a data anterior quando ele muda;
 * o hash cobre título, disciplina, tipo e, em posts/mensagens, o texto.
 */
export function itemSignature(entry: AgendaEntry): string {
  const { item } = entry;
  const content = [
    normalize(item.title),
    normalize(item.discipline ?? ''),
    entry.kind,
    editableOrigins.has(originOf(item)) ? normalize(item.description) : '',
  ].join('|');
  return `${entry.date?.value ?? ''}#${fnv(content)}`;
}

function signatureDue(signature: string): string {
  return signature.split('#')[0] ?? '';
}

export interface PendingNotification {
  item: AcademicItem;
  entry?: AgendaEntry;
  reason: NotificationReason;
  previousDue?: string;
}

export interface NotificationPlan {
  notifications: PendingNotification[];
  log: NotificationLogEntry[];
}

/**
 * Decide o que avisar: atividade nova, prazo alterado, conteúdo atualizado, ou prazo que ficou
 * urgente/atrasado (uma vez por nível). Itens já avisados e sem mudança não geram mensagem.
 * Na primeira vez (log vazio), registra tudo em silêncio e só avisa o que surgiu nesta coleta.
 */
export function planNotifications(input: {
  agenda: Agenda;
  items: AcademicItem[];
  log: NotificationLogEntry[];
  newItemIds: ReadonlySet<string>;
  now: Date;
}): NotificationPlan {
  const { agenda, now } = input;
  const logById = new Map(input.log.map((entry) => [entry.itemId, entry]));
  const seeding = input.log.length === 0;
  const notifications: PendingNotification[] = [];
  const log: NotificationLogEntry[] = [];
  const nowIso = now.toISOString();

  const tracked = [
    ...agenda.exams,
    ...agenda.tasks,
    ...agenda.overdue,
    ...agenda.undated,
    ...agenda.conditionalExams,
  ];
  for (const entry of tracked) {
    const { item } = entry;
    const signature = itemSignature(entry);
    const level: NotifiedLevel = alertLevel(entry, now);
    const previous = logById.get(item.id);
    let reason: NotificationReason | undefined;
    let previousDue: string | undefined;
    if (!previous) {
      if (!seeding || input.newItemIds.has(item.id)) reason = 'new';
    } else if (signatureDue(previous.signature) !== (entry.date?.value ?? '')) {
      reason = 'date';
      previousDue = signatureDue(previous.signature) || undefined;
    } else if (previous.signature !== signature) {
      reason = 'changed';
    } else if (isEscalation(level, previous.level)) {
      reason = 'urgent';
    }
    // 2ª chamada e finais só entram no painel; não geram alerta.
    if (entry.conditional) reason = undefined;
    if (reason) {
      notifications.push({
        item,
        entry,
        reason,
        ...(previousDue ? { previousDue } : {}),
      });
    }
    const changed = !previous || previous.signature !== signature || previous.level !== level;
    if (reason || changed) {
      log.push({
        itemId: item.id,
        signature,
        level,
        lastNotifiedAt: reason ? nowIso : (previous?.lastNotifiedAt ?? ''),
      });
    }
    // Fontes repetidas da mesma atividade ficam registradas para não gerarem alerta próprio.
    for (const related of entry.related) {
      if (!logById.has(related.id)) {
        log.push({ itemId: related.id, signature, level, lastNotifiedAt: '' });
      }
    }
  }

  for (const item of input.items) {
    if (!input.newItemIds.has(item.id) || focusKind(item)) continue;
    if (!isOpen(item) || isAiIrrelevant(item)) continue;
    notifications.push({ item, reason: 'notice' });
  }

  // Mais urgente primeiro; avisos por último.
  notifications.sort((left, right) => {
    const leftDue = left.entry?.due?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const rightDue = right.entry?.due?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return leftDue - rightDue;
  });
  return { notifications, log };
}
