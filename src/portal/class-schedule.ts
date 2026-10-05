import type { ClassSlot } from '../models/class-schedule.js';

/** Uma coluna do Quadro de Horários: o dia e os tempos de aula na ordem da página. */
export interface ScheduleColumnInput {
  day: string;
  entries: Array<{ code: string; title: string; time: string }>;
}

const weekdays: Record<string, number> = {
  domingo: 0,
  segunda: 1,
  terca: 2,
  quarta: 3,
  quinta: 4,
  sexta: 5,
  sabado: 6,
};

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function weekdayOf(day: string): number | undefined {
  const key = clean(day)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .split(/[-\s]/)[0];
  return key ? weekdays[key] : undefined;
}

function minutes(time: string): number {
  const [hours = 0, mins = 0] = time.split(':').map(Number);
  return hours * 60 + mins;
}

/** Tempos seguidos da mesma disciplina (intervalo de até 15 min) viram um bloco de aula. */
const MAX_GAP_MINUTES = 15;

export function buildClassSlots(
  columns: ScheduleColumnInput[],
  period: string,
  legend: Record<string, string> = {},
): ClassSlot[] {
  const slots: ClassSlot[] = [];
  for (const column of columns) {
    const weekday = weekdayOf(column.day);
    if (weekday === undefined) continue;
    const entries = column.entries
      .flatMap((entry) => {
        const code = clean(entry.code).toUpperCase();
        const time = /(\d{1,2}:\d{2})\s*~\s*(\d{1,2}:\d{2})/.exec(entry.time);
        if (!code || code === '-' || !time?.[1] || !time[2]) return [];
        const pad = (value: string) => value.padStart(5, '0');
        return [
          {
            code,
            discipline: clean(entry.title) || legend[code] || code,
            start: pad(time[1]),
            end: pad(time[2]),
          },
        ];
      })
      .sort((left, right) => left.start.localeCompare(right.start));
    for (const entry of entries) {
      const previous = slots[slots.length - 1];
      if (
        previous &&
        previous.weekday === weekday &&
        previous.code === entry.code &&
        minutes(entry.start) - minutes(previous.endTime) <= MAX_GAP_MINUTES &&
        minutes(entry.start) >= minutes(previous.startTime)
      ) {
        previous.endTime = entry.end;
        continue;
      }
      slots.push({
        code: entry.code,
        discipline: entry.discipline,
        weekday,
        startTime: entry.start,
        endTime: entry.end,
        online: /EAD$/.test(entry.code),
        period: clean(period),
      });
    }
  }
  return slots;
}

/** Texto curto do quadro, para contexto da IA e de quem lê a planilha. */
export function describeClassSlots(slots: ClassSlot[]): string {
  const names = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  return names
    .map((name, weekday) => {
      const day = slots.filter((slot) => slot.weekday === weekday);
      if (day.length === 0) return '';
      return `${name}: ${day
        .map(
          (slot) =>
            `${slot.discipline} ${slot.startTime}–${slot.endTime}${slot.online ? ' (EAD)' : ''}`,
        )
        .join('; ')}`;
    })
    .filter(Boolean)
    .join('\n');
}
