import { differenceInCalendarDays, differenceInHours } from 'date-fns';
import type { AcademicItem, ItemType, Urgency } from '../models/academic-item.js';
import { localDateKey, parseAcademicDate } from '../utils/dates.js';

const urgencyScore: Record<Urgency, number> = {
  OVERDUE: 700,
  TODAY: 600,
  NEXT_24_HOURS: 500,
  NEXT_72_HOURS: 400,
  THIS_WEEK: 300,
  FUTURE: 200,
  INFORMATIONAL: 100,
};

const typeScore: Partial<Record<ItemType, number>> = {
  EXAM: 50,
  GRADE: 45,
  AOP: 42,
  ASSIGNMENT: 40,
  DOCUMENT: 38,
  SERVICE_REQUEST: 35,
  SCHEDULE_CHANGE: 34,
  ACTIVITY: 30,
};

export function classifyUrgency(item: AcademicItem, now = new Date()): Urgency {
  if (item.status === 'DONE' || item.status === 'IGNORED') return 'INFORMATIONAL';
  const value = item.officialDeadline ?? item.officialDate;
  if (!value) return 'INFORMATIONAL';
  const due = parseAcademicDate(value, Boolean(item.officialDeadline));
  if (Number.isNaN(due.getTime())) return 'INFORMATIONAL';
  if (due.getTime() < now.getTime()) return 'OVERDUE';
  if (localDateKey(due) === localDateKey(now)) return 'TODAY';
  const hours = differenceInHours(due, now);
  if (hours <= 24) return 'NEXT_24_HOURS';
  if (hours <= 72) return 'NEXT_72_HOURS';
  if (differenceInCalendarDays(due, now) <= 7) return 'THIS_WEEK';
  return 'FUTURE';
}

export function priorityScore(item: AcademicItem, now = new Date()): number {
  const urgency = classifyUrgency(item, now);
  const normalized = `${item.title} ${item.description}`
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
  let score = urgencyScore[urgency] + (typeScore[item.type] ?? 0);
  if (/obrigatori|presenca obrigatoria|prazo|pendencia|estagio/.test(normalized)) score += 15;
  if (/opcional|facultativ/.test(normalized)) score -= 20;
  if (item.previousHash) score += 10;
  if (item.status === 'IN_PROGRESS') score -= 5;
  return score;
}

export function prioritizeItems(items: AcademicItem[], now = new Date()): AcademicItem[] {
  return items
    .filter((item) => item.status !== 'DONE' && item.status !== 'IGNORED')
    .map((item) => ({ ...item, urgency: classifyUrgency(item, now) }))
    .sort((left, right) => {
      const scoreDifference = priorityScore(right, now) - priorityScore(left, now);
      if (scoreDifference !== 0) return scoreDifference;
      return (left.officialDeadline ?? left.officialDate ?? '9999').localeCompare(
        right.officialDeadline ?? right.officialDate ?? '9999',
      );
    });
}

export function selectProgressCheckins(
  items: AcademicItem[],
  statusUpdatedAt: ReadonlyMap<string, string>,
  now = new Date(),
): AcademicItem[] {
  return prioritizeItems(items, now)
    .filter((item) => {
      if (!['TODO', 'NEEDS_CONFIRMATION'].includes(item.status)) return false;
      if (['OVERDUE', 'TODAY', 'NEXT_24_HOURS', 'NEXT_72_HOURS'].includes(item.urgency))
        return true;
      const updatedAt = statusUpdatedAt.get(item.id);
      return !updatedAt || now.getTime() - new Date(updatedAt).getTime() >= 3 * 24 * 60 * 60_000;
    })
    .slice(0, 3);
}
