import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { ACADEMIC_TIMEZONE, localDateKey } from '../utils/dates.js';

const weekdayNames = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const shortWeekdays = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Dia da semana local (0 = domingo). */
export function localWeekday(date: Date): number {
  return toZonedTime(date, ACADEMIC_TIMEZONE).getDay();
}

export function weekdayLabel(date: Date): string {
  return weekdayNames[localWeekday(date)] ?? '';
}

export function shortWeekdayLabel(day: number): string {
  return shortWeekdays[day] ?? '';
}

/** "19:00" no fuso acadêmico. */
export function localTime(date: Date): string {
  const local = toZonedTime(date, ACADEMIC_TIMEZONE);
  return `${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`;
}

/** "05/10" */
export function localDayMonth(date: Date): string {
  const [, month, day] = localDateKey(date).split('-');
  return `${day ?? ''}/${month ?? ''}`;
}

/** Instante de um dia e horário locais ("2026-10-09", "14:00"). */
export function zonedInstant(dateKey: string, time = '00:00'): Date {
  return fromZonedTime(`${dateKey}T${time}:00`, ACADEMIC_TIMEZONE);
}

export function isValidDateKey(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const instant = zonedInstant(value, '12:00');
  return Number.isFinite(instant.getTime()) && localDateKey(instant) === value;
}

/** Soma dias a uma data local "YYYY-MM-DD". */
export function addDays(dateKey: string, days: number): string {
  return localDateKey(new Date(zonedInstant(dateKey, '12:00').getTime() + days * 86_400_000));
}

/** Início (inclusivo) e fim (exclusivo) dos dias locais de `from` até `to`, inclusive. */
export function dayRange(from: string, to: string): { start: Date; end: Date } {
  return { start: zonedInstant(from), end: zonedInstant(addDays(to, 1)) };
}

export function daysBetween(from: string, to: string): number {
  return Math.round(
    (zonedInstant(to, '12:00').getTime() - zonedInstant(from, '12:00').getTime()) / 86_400_000,
  );
}

/** Segunda a domingo da semana que contém `dateKey`. */
export function weekOf(dateKey: string): { from: string; to: string } {
  const weekday = localWeekday(zonedInstant(dateKey, '12:00'));
  const offset = weekday === 0 ? -6 : 1 - weekday;
  const from = addDays(dateKey, offset);
  return { from, to: addDays(from, 6) };
}

/**
 * Tabela de datas dos próximos dias para o modelo interpretar "sexta", "sexta que vem",
 * "semana que vem" e "dia 15" sem fazer contas de calendário.
 */
export function dateReference(now: Date, days = 21): string {
  const today = localDateKey(now);
  const lines: string[] = [];
  for (let offset = 0; offset < days; offset += 1) {
    const key = addDays(today, offset);
    const date = zonedInstant(key, '12:00');
    const tag = offset === 0 ? ' (hoje)' : offset === 1 ? ' (amanhã)' : '';
    lines.push(`${shortWeekdays[localWeekday(date)] ?? ''} ${key}${tag}`);
  }
  const week = weekOf(today);
  const nextWeek = weekOf(addDays(week.to, 1));
  const [year, month] = today.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year ?? 2000, month ?? 1, 0)).getUTCDate();
  return [
    lines.join(' | '),
    `Esta semana: ${week.from} a ${week.to}. Semana que vem: ${nextWeek.from} a ${nextWeek.to}. Fim do mês: ${today.slice(0, 8)}${String(lastDay).padStart(2, '0')}.`,
  ].join('\n');
}

/** "segunda, 05/10" */
export function longDayLabel(dateKey: string): string {
  const date = zonedInstant(dateKey, '12:00');
  return `${weekdayLabel(date)}, ${localDayMonth(date)}`;
}
