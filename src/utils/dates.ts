import { differenceInCalendarDays } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';

export const ACADEMIC_TIMEZONE = 'America/Sao_Paulo';

export function parseAcademicDate(value: string, endOfDay = false): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return fromZonedTime(`${value}T${endOfDay ? '23:59:59' : '12:00:00'}`, ACADEMIC_TIMEZONE);
  }
  if (/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return new Date(value);
  return fromZonedTime(value, ACADEMIC_TIMEZONE);
}

export function localDateKey(value: Date): string {
  const local = toZonedTime(value, ACADEMIC_TIMEZONE);
  const year = String(local.getFullYear());
  const month = String(local.getMonth() + 1).padStart(2, '0');
  const day = String(local.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function localDateAt(value: Date, hours: number, minutes = 0, dayOffset = 0): Date {
  const local = toZonedTime(value, ACADEMIC_TIMEZONE);
  local.setDate(local.getDate() + dayOffset);
  local.setHours(hours, minutes, 0, 0);
  return fromZonedTime(local, ACADEMIC_TIMEZONE);
}

/** Dias de calendário (no fuso acadêmico) entre `now` e `target`; negativo quando já passou. */
export function calendarDaysUntil(target: Date, now: Date): number {
  return differenceInCalendarDays(
    toZonedTime(target, ACADEMIC_TIMEZONE),
    toZonedTime(now, ACADEMIC_TIMEZONE),
  );
}

export function hasExplicitTime(value: string): boolean {
  return /T\d{2}:\d{2}/.test(value);
}

function formatPart(date: Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: ACADEMIC_TIMEZONE, ...options }).format(date);
}

/** "seg, 05/10" ou "seg, 05/10 · 19h00". */
export function formatShortDate(value: string, deadline = false): string {
  const date = parseAcademicDate(value, deadline);
  if (Number.isNaN(date.getTime())) return 'data inválida';
  const weekday = formatPart(date, { weekday: 'short' }).replace('.', '');
  const day = formatPart(date, { day: '2-digit', month: '2-digit' });
  if (!hasExplicitTime(value)) return `${weekday}, ${day}`;
  const time = formatPart(date, { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${weekday}, ${day} · ${time.replace(':', 'h')}`;
}

/** "quinta-feira, 02/10". */
export function formatLongDay(date: Date): string {
  const weekday = formatPart(date, { weekday: 'long' });
  return `${weekday}, ${formatPart(date, { day: '2-digit', month: '2-digit' })}`;
}

export function relativeDayLabel(days: number): string {
  if (days === 0) return 'hoje';
  if (days === 1) return 'amanhã';
  if (days === -1) return 'ontem';
  return days > 1 ? `em ${String(days)} dias` : `há ${String(-days)} dias`;
}
