import { publishedAt } from '../agenda/focus.js';
import type { AcademicItem } from '../models/academic-item.js';
import { classSlotId, sameDiscipline, type ClassSlot } from '../models/class-schedule.js';
import { localDateKey } from '../utils/dates.js';
import { addDays } from './dates.js';
import type { WeeklySlot } from './memory.js';

/** Quadro do Portal no mesmo formato das aulas que o usuário conta ao assistente. */
export function classWeeklySlots(classes: readonly ClassSlot[]): WeeklySlot[] {
  return classes.map((slot) => ({
    id: classSlotId(slot),
    title: `Aula de ${slot.discipline}${slot.online ? ' (EAD)' : ''}`,
    weekday: slot.weekday,
    startTime: slot.startTime,
    endTime: slot.endTime,
    category: 'aula',
    source: 'portal',
    discipline: slot.discipline,
    ...(slot.online ? { online: true } : {}),
  }));
}

export interface ClassCancellation {
  discipline: string;
  date: string;
  /** Título do aviso que cancelou a aula. */
  title: string;
  itemId: string;
}

const CANCELLATION =
  /n[aã]o\s+(?:haver[aá]|teremos|vai\s+ter|ter[aá]|vamos\s+ter)\s+aula|aula\s+(?:cancelada|suspensa)|sem\s+aula\s+(?:hoje|amanh|dia|na|no)|aula\s+n[aã]o\s+(?:vai\s+)?(?:acontecer|ocorrer)/i;

/**
 * Avisos do professor de que não haverá aula num dia ("não haverá aula de Mobile amanhã dia
 * 05/10"). A data vem do texto (dd/mm) ou de "hoje"/"amanhã" a partir da publicação.
 */
export function classCancellations(items: readonly AcademicItem[], now: Date): ClassCancellation[] {
  const result: ClassCancellation[] = [];
  for (const item of items) {
    if (!item.discipline) continue;
    const text = `${item.title}\n${item.description}`;
    if (!CANCELLATION.test(text)) continue;
    const published = localDateKey(publishedAt(item, now));
    const year = Number(published.slice(0, 4));
    const dates = new Set<string>();
    for (const match of text.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)) {
      const day = Number(match[1]);
      const month = Number(match[2]);
      if (day < 1 || day > 31 || month < 1 || month > 12) continue;
      const explicit = match[3] ? Number(match[3]) : undefined;
      const fullYear = explicit ? (explicit < 100 ? 2000 + explicit : explicit) : year;
      const key = `${String(fullYear)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      // Datas muito antes da publicação são referências a outra coisa.
      if (key >= addDays(published, -1)) dates.add(key);
    }
    if (dates.size === 0 && /amanh[ãa]/i.test(text)) dates.add(addDays(published, 1));
    if (dates.size === 0 && /\bhoje\b/i.test(text)) dates.add(published);
    for (const date of dates) {
      result.push({ discipline: item.discipline, date, title: item.title, itemId: item.id });
    }
  }
  return result;
}

/** "Desenvolvimento Mobile 19:10–20:50 (cancelada: ...)"; "nenhuma aula presencial hoje". */
export function classesTodayText(
  classes: readonly ClassSlot[],
  cancellations: readonly ClassCancellation[],
  now: Date,
): string | undefined {
  if (classes.length === 0) return undefined;
  const today = localDateKey(now);
  const weekday = new Date(`${today}T12:00:00-03:00`).getUTCDay();
  const list = classes
    .filter((slot) => slot.weekday === weekday && !slot.online)
    .sort((left, right) => left.startTime.localeCompare(right.startTime))
    .map((slot) => {
      const cancelled = cancellationFor(cancellations, slot.discipline, today);
      return `${slot.discipline} ${slot.startTime}–${slot.endTime}${cancelled ? ` (cancelada: "${cancelled.title}")` : ''}`;
    });
  return list.length > 0 ? list.join('; ') : 'nenhuma aula presencial hoje';
}

export function cancellationFor(
  cancellations: readonly ClassCancellation[] | undefined,
  discipline: string | undefined,
  date: string,
): ClassCancellation | undefined {
  return cancellations?.find(
    (cancellation) =>
      cancellation.date === date && sameDiscipline(cancellation.discipline, discipline),
  );
}
