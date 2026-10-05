import { localDateKey } from '../utils/dates.js';
import { addDays, daysBetween, localTime, TIME_PATTERN, zonedInstant } from './dates.js';

export interface FreeSlot {
  date: string;
  start: string;
  end: string;
  minutes: number;
}

export interface FreeTimeInput {
  from: string;
  to: string;
  now: Date;
  busy: Array<{ start: Date; end: Date }>;
  /** Janela diária em que faz sentido estudar. */
  dayStart?: string;
  dayEnd?: string;
  minMinutes?: number;
}

/**
 * Horários livres por dia, descontando aulas, compromissos e provas. Respeita a janela diária
 * (padrão 08:00–22:30), ignora o que já passou e deixa 10 minutos de folga em volta dos eventos.
 */
export function freeSlots(input: FreeTimeInput): FreeSlot[] {
  const dayStart = TIME_PATTERN.test(input.dayStart ?? '') ? input.dayStart! : '08:00';
  const dayEnd = TIME_PATTERN.test(input.dayEnd ?? '') ? input.dayEnd! : '22:30';
  const minMinutes = Math.max(15, input.minMinutes ?? 45);
  const margin = 10 * 60_000;
  const busy = input.busy
    .map((interval) => ({
      start: interval.start.getTime() - margin,
      end: interval.end.getTime() + margin,
    }))
    .sort((left, right) => left.start - right.start);
  const slots: FreeSlot[] = [];
  const days = Math.min(31, Math.max(0, daysBetween(input.from, input.to)));
  for (let offset = 0; offset <= days; offset += 1) {
    const date = addDays(input.from, offset);
    let cursor = Math.max(zonedInstant(date, dayStart).getTime(), input.now.getTime());
    const limit = zonedInstant(date, dayEnd).getTime();
    // Arredonda para o próximo múltiplo de 15 minutos: "14:07" vira "14:15".
    cursor = Math.ceil(cursor / (15 * 60_000)) * 15 * 60_000;
    for (const interval of busy) {
      if (interval.end <= cursor || interval.start >= limit) continue;
      if (interval.start > cursor)
        push(slots, date, cursor, Math.min(interval.start, limit), minMinutes);
      cursor = Math.max(cursor, interval.end);
      if (cursor >= limit) break;
    }
    if (cursor < limit) push(slots, date, cursor, limit, minMinutes);
  }
  return slots;
}

function push(
  slots: FreeSlot[],
  date: string,
  start: number,
  end: number,
  minMinutes: number,
): void {
  const minutes = Math.floor((end - start) / 60_000);
  if (minutes < minMinutes) return;
  const startDate = new Date(start);
  if (localDateKey(startDate) !== date) return;
  slots.push({ date, start: localTime(startDate), end: localTime(new Date(end)), minutes });
}
