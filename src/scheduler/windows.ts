import { toZonedTime } from 'date-fns-tz';
import { ACADEMIC_TIMEZONE, localDateAt } from '../utils/dates.js';

/** 21h permanece aceito para execuções antigas; novos agendamentos usam 20h. */
export type DailySlot = '12:00' | '17:00' | '20:00' | '21:00';

export interface VerificationWindow {
  from: Date;
  to: Date;
  slot: DailySlot;
}

export function verificationWindow(now: Date, slot: DailySlot): VerificationWindow {
  if (slot === '12:00') {
    return { from: localDateAt(now, 20, 0, -1), to: localDateAt(now, 12), slot };
  }
  if (slot === '17:00') {
    return { from: localDateAt(now, 12), to: localDateAt(now, 17), slot };
  }
  return { from: localDateAt(now, 17), to: localDateAt(now, slot === '20:00' ? 20 : 21), slot };
}

export function isWeeklyReviewRun(now: Date, slot: DailySlot): boolean {
  if (slot !== '20:00' && slot !== '21:00') return false;
  const local = toZonedTime(now, ACADEMIC_TIMEZONE);
  return local.getDay() === 0 || local.getDay() === 3;
}

export function shouldSend72HourSummary(slot: DailySlot): boolean {
  return slot === '20:00' || slot === '21:00';
}
