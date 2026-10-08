import { toZonedTime } from 'date-fns-tz';
import { ACADEMIC_TIMEZONE, localDateAt } from '../utils/dates.js';

export const scheduledSlots = [
  '10:00',
  '12:00',
  '14:00',
  '16:00',
  '18:00',
  '20:00',
  '21:00',
  '22:00',
  '23:00',
] as const;

export type ScheduledSlot = (typeof scheduledSlots)[number];
export type DailySlot = ScheduledSlot;

export interface VerificationWindow {
  from: Date;
  to: Date;
  slot: DailySlot;
}

export function verificationWindow(now: Date, slot: DailySlot): VerificationWindow {
  const hour = Number(slot.slice(0, 2));
  const slotIndex = scheduledSlots.indexOf(slot);
  if (slotIndex === 0) {
    return { from: localDateAt(now, 23, 0, -1), to: localDateAt(now, hour), slot };
  }
  if (slotIndex > 0) {
    const previousSlot = scheduledSlots[slotIndex - 1];
    if (!previousSlot) throw new Error(`Horário anterior ausente para: ${slot}`);
    const previousHour = Number(previousSlot.slice(0, 2));
    return { from: localDateAt(now, previousHour), to: localDateAt(now, hour), slot };
  }
  throw new Error(`Horário de coleta inválido: ${slot}`);
}

export function isWeeklyReviewRun(now: Date, slot: DailySlot): boolean {
  if (slot !== '20:00') return false;
  const local = toZonedTime(now, ACADEMIC_TIMEZONE);
  return local.getDay() === 0 || local.getDay() === 3;
}

export function shouldSend72HourSummary(slot: DailySlot): boolean {
  return ['20:00', '21:00', '22:00', '23:00'].includes(slot);
}
