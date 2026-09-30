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
