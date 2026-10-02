import type { AgendaEntry } from '../agenda/agenda.js';
import type { NotifiedLevel } from '../models/bot.js';

export type PriorityLevel = 'critical' | 'high' | 'medium' | 'normal' | 'info';

/**
 * critical: atrasado ou vence hoje · high: até 3 dias · medium: 4 a 7 dias ·
 * normal: mais de 7 dias ou sem data · info: comunicado sem ação.
 */
export function priorityOf(entry: AgendaEntry | undefined, now: Date): PriorityLevel {
  if (!entry) return 'info';
  if (!entry.due || entry.days === undefined) return 'normal';
  if (entry.days <= 0 || (entry.kind === 'TASK' && entry.due.getTime() < now.getTime())) {
    return 'critical';
  }
  if (entry.days <= 3) return 'high';
  if (entry.days <= 7) return 'medium';
  return 'normal';
}

/** Nível de alerta proativo: só os que justificam avisar de novo. */
export function alertLevel(entry: AgendaEntry, now: Date): NotifiedLevel {
  if (!entry.due || entry.days === undefined) return 'none';
  if (entry.kind === 'TASK' && entry.due.getTime() < now.getTime()) return 'overdue';
  const priority = priorityOf(entry, now);
  if (priority === 'critical') return 'critical';
  if (priority === 'high') return 'high';
  return 'none';
}

const levelRank: Record<NotifiedLevel, number> = { none: 0, high: 1, critical: 2, overdue: 3 };

export function isEscalation(current: NotifiedLevel, notified: NotifiedLevel): boolean {
  return levelRank[current] > levelRank[notified];
}
