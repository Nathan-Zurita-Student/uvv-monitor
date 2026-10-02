import type { AgendaEntry } from '../agenda/agenda.js';
import { calendarDaysUntil, localDateAt, localDateKey } from '../utils/dates.js';
import { clock, dayMonth } from './activity.js';
import type { ReminderOption } from './callbacks.js';

const MINUTE = 60_000;

/** Horário do lembrete para cada opção; undefined quando a opção não faz sentido agora. */
export function reminderTime(
  option: Exclude<ReminderOption, 'custom'>,
  entry: AgendaEntry | undefined,
  now: Date,
): Date | undefined {
  if (option === '30m') return new Date(now.getTime() + 30 * MINUTE);
  if (option === '1h') return new Date(now.getTime() + 60 * MINUTE);
  if (option === 'night') {
    const night = localDateAt(now, 20);
    return night.getTime() - now.getTime() >= 30 * MINUTE ? night : undefined;
  }
  if (option === 'tomorrow') return localDateAt(now, 9, 0, 1);
  // 1 dia antes: às 9h da véspera do prazo.
  if (!entry?.due) return undefined;
  const dayBefore = localDateAt(entry.due, 9, 0, -1);
  return dayBefore.getTime() - now.getTime() >= 30 * MINUTE ? dayBefore : undefined;
}

export function reminderChoices(
  entry: AgendaEntry | undefined,
  now: Date,
): Array<{ option: ReminderOption; label: string }> {
  const labels: Record<ReminderOption, string> = {
    '30m': '30 min',
    '1h': '1 hora',
    night: 'Hoje à noite',
    tomorrow: 'Amanhã cedo',
    daybefore: '1 dia antes',
    custom: '🕒 Escolher horário',
  };
  return (Object.keys(labels) as ReminderOption[])
    .filter((option) => option === 'custom' || reminderTime(option, entry, now))
    .map((option) => ({ option, label: labels[option] }));
}

/** "hoje às 20:00", "amanhã às 09:00" ou "qua, 08/10 às 14:00". */
export function describeReminder(date: Date, now: Date): string {
  const days = calendarDaysUntil(date, now);
  const prefix =
    days === 0
      ? 'hoje'
      : days === 1
        ? 'amanhã'
        : `${new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short' }).format(date).replace('.', '')}, ${dayMonth(date)}`;
  return `${prefix} às ${clock(date)}`;
}

function atLocal(base: Date, dayOffset: number, hours: number, minutes: number): Date {
  return localDateAt(base, hours, minutes, dayOffset);
}

/**
 * Entende respostas livres como "18:30", "20h", "amanhã 9h", "15/10 14h", "em 2 horas" ou
 * "em 40 min". Retorna undefined quando não reconhece ou quando o horário já passou.
 */
export function parseReminderText(text: string, now: Date): Date | undefined {
  const normalized = text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

  const relative = /^(?:daqui a|em)\s*(\d{1,3})\s*(min|minutos?|h|horas?)$/.exec(normalized);
  if (relative?.[1] && relative[2]) {
    const amount = Number(relative[1]);
    const minutes = relative[2].startsWith('m') ? amount : amount * 60;
    return minutes > 0 ? new Date(now.getTime() + minutes * MINUTE) : undefined;
  }

  const time = /(\d{1,2})(?:\s*(?::|h)\s*(\d{2})?)?\s*(?:h(?:oras?)?)?$/.exec(normalized);
  const hours = time?.[1] ? Number(time[1]) : undefined;
  const minutes = time?.[2] ? Number(time[2]) : 0;
  const hasClock = /\d{1,2}\s*(?::\d{2}|h)/.test(normalized) || /^\d{1,2}$/.test(normalized);

  const date = /(\d{1,2})\/(\d{1,2})/.exec(normalized);
  if (date?.[1] && date[2]) {
    const day = Number(date[1]);
    const month = Number(date[2]);
    const year = Number(localDateKey(now).slice(0, 4));
    const rest = normalized.replace(date[0], '');
    const restTime = /(\d{1,2})(?:\s*(?::|h)\s*(\d{2})?)?/.exec(rest);
    const targetHours = restTime?.[1] ? Number(restTime[1]) : 9;
    const targetMinutes = restTime?.[2] ? Number(restTime[2]) : 0;
    if (month < 1 || month > 12 || day < 1 || day > 31 || targetHours > 23 || targetMinutes > 59) {
      return undefined;
    }
    const key = `${String(year)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    let candidate = atLocal(new Date(`${key}T12:00:00-03:00`), 0, targetHours, targetMinutes);
    if (candidate.getTime() < now.getTime()) {
      candidate = atLocal(
        new Date(`${String(year + 1)}-${key.slice(5)}T12:00:00-03:00`),
        0,
        targetHours,
        targetMinutes,
      );
    }
    return candidate;
  }

  if (hours === undefined || !hasClock || hours > 23 || minutes > 59) return undefined;
  if (/amanha/.test(normalized)) return atLocal(now, 1, hours, minutes);
  if (/^(?:hoje\s*)?(?:as\s*)?\d/.test(normalized)) {
    const today = atLocal(now, 0, hours, minutes);
    return today.getTime() > now.getTime() ? today : atLocal(now, 1, hours, minutes);
  }
  return undefined;
}
