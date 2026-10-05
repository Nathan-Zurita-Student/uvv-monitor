import { effectiveType, isAiIrrelevant } from '../agenda/focus.js';
import type { AcademicItem } from '../models/academic-item.js';
import { classOn, IN_CLASS_PATTERN, type ClassSlot } from '../models/class-schedule.js';
import { normalizeText, stableStringify } from '../utils/normalize.js';
import type { CalendarEventDate, CalendarEventInput, CalendarGateway } from './types.js';

export type CalendarSyncResult =
  | { action: 'SKIPPED_UNCONFIRMED' }
  | { action: 'SKIPPED_EQUIVALENT' }
  | { action: 'UNCHANGED'; eventId: string }
  | { action: 'WOULD_CREATE' }
  | { action: 'WOULD_UPDATE'; eventId: string }
  | { action: 'CREATED'; eventId: string }
  | { action: 'UPDATED'; eventId: string };

const calendarItemTypes = new Set<AcademicItem['type']>([
  'EXAM',
  'ASSIGNMENT',
  'AOP',
  'ACTIVITY',
  'EVENT',
  'SCHEDULE_CHANGE',
  'DOCUMENT',
  'SERVICE_REQUEST',
]);

export function isCalendarSyncCandidate(item: AcademicItem): boolean {
  return (
    calendarItemTypes.has(item.type) &&
    calendarItemTypes.has(effectiveType(item)) &&
    !isAiIrrelevant(item) &&
    !['DONE', 'IGNORED', 'NEEDS_CONFIRMATION'].includes(item.status) &&
    !['OVERDUE', 'INFORMATIONAL'].includes(item.urgency) &&
    item.metadata?.contextOnly !== 'true' &&
    Boolean(item.officialDeadline ?? item.officialDate)
  );
}

function eventDate(
  value: string,
  deadline: boolean,
): { start: CalendarEventDate; end: CalendarEventDate } {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const end = new Date(`${value}T12:00:00-03:00`);
    end.setDate(end.getDate() + 1);
    return {
      start: { date: value },
      end: { date: end.toISOString().slice(0, 10) },
    };
  }
  const instant = new Date(/(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}-03:00`);
  if (Number.isNaN(instant.getTime())) throw new Error(`Data oficial inválida: ${value}`);
  const durationMinutes = deadline ? 30 : 60;
  return {
    start: { dateTime: value, timeZone: 'America/Sao_Paulo' },
    end: {
      dateTime: new Date(instant.getTime() + durationMinutes * 60_000).toISOString(),
      timeZone: 'America/Sao_Paulo',
    },
  };
}

function eventTitle(item: AcademicItem): string {
  const subject = item.discipline ?? item.title;
  const labels: Partial<Record<AcademicItem['type'], string>> = {
    EXAM: 'Prova',
    ASSIGNMENT: 'Entrega',
    AOP: 'AOP',
    EVENT: 'Evento',
    SCHEDULE_CHANGE: 'Alteração',
    DOCUMENT: 'Prazo documental',
  };
  return `[UVV] ${labels[item.type] ?? item.title} — ${subject}`;
}

/**
 * Prova ou apresentação com dia mas sem hora: se a disciplina tem aula presencial nesse dia da
 * semana, o horário mais provável é o da aula.
 */
export function classTimeFor(
  item: AcademicItem,
  value: string,
  slots: readonly ClassSlot[],
): ClassSlot | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || slots.length === 0) return undefined;
  const text = `${item.title} ${item.description} ${item.metadata?.aiSummary ?? ''}`;
  if (effectiveType(item) !== 'EXAM' && !IN_CLASS_PATTERN.test(text)) return undefined;
  const weekday = new Date(`${value}T12:00:00-03:00`).getUTCDay();
  return classOn(slots, item.discipline, weekday);
}

export function buildCalendarEvent(
  item: AcademicItem,
  detectedAt: string,
  classSlots: readonly ClassSlot[] = [],
): CalendarEventInput | undefined {
  const officialValue = item.officialDeadline ?? item.officialDate;
  if (!officialValue || item.status === 'NEEDS_CONFIRMATION') return undefined;
  const classSlot = classTimeFor(item, officialValue, classSlots);
  const dates = classSlot
    ? {
        start: {
          dateTime: `${officialValue}T${classSlot.startTime}:00`,
          timeZone: 'America/Sao_Paulo',
        },
        end: {
          dateTime: `${officialValue}T${classSlot.endTime}:00`,
          timeZone: 'America/Sao_Paulo',
        },
      }
    : eventDate(officialValue, Boolean(item.officialDeadline));
  return {
    summary: eventTitle(item),
    description: [
      `Origem: ${item.source}`,
      `Disciplina: ${item.discipline ?? 'Não informada'}`,
      `Link da fonte: ${item.sourceUrl}`,
      `Prazo oficial: ${officialValue}`,
      ...(classSlot
        ? [
            `Horário: o aviso não informou a hora; marquei no horário da aula de ${classSlot.discipline} (${classSlot.startTime}–${classSlot.endTime}), segundo o Quadro de Horários. Confirme com o professor.`,
          ]
        : []),
      `Identificador interno: ${item.id}`,
      `Detectado em: ${detectedAt}`,
    ].join('\n'),
    ...dates,
    extendedProperties: {
      private: {
        uvvItemId: item.id,
        uvvExternalId: item.externalId,
        uvvSource: item.source,
        uvvContentHash: item.contentHash,
      },
    },
  };
}

/**
 * O Google devolve "2026-10-14T19:10:00-03:00" para o que foi gravado como "2026-10-14T19:10:00"
 * em America/Sao_Paulo: compara o instante, não o texto.
 */
function moment(value: CalendarEventDate): string {
  if (value.date) return value.date;
  if (!value.dateTime) return '';
  const instant = new Date(
    /(?:Z|[+-]\d{2}:\d{2})$/.test(value.dateTime) ? value.dateTime : `${value.dateTime}-03:00`,
  );
  return Number.isNaN(instant.getTime()) ? value.dateTime : String(instant.getTime());
}

function equivalent(left: CalendarEventInput, right: CalendarEventInput): boolean {
  const comparable = (event: CalendarEventInput) => ({
    summary: normalizeText(event.summary),
    description: normalizeText(event.description),
    start: moment(event.start),
    end: moment(event.end),
    itemId: event.extendedProperties.private.uvvItemId,
    contentHash: event.extendedProperties.private.uvvContentHash,
  });
  return stableStringify(comparable(left)) === stableStringify(comparable(right));
}

function sameVisibleEvent(left: CalendarEventInput, right: CalendarEventInput): boolean {
  return (
    normalizeText(left.summary) === normalizeText(right.summary) &&
    moment(left.start) === moment(right.start) &&
    moment(left.end) === moment(right.end)
  );
}

function searchWindow(value: string): { timeMin: string; timeMax: string } {
  const instant = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? `${value}T12:00:00-03:00`
      : /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
        ? value
        : `${value}-03:00`,
  );
  return {
    timeMin: new Date(instant.getTime() - 24 * 60 * 60_000).toISOString(),
    timeMax: new Date(instant.getTime() + 24 * 60 * 60_000).toISOString(),
  };
}

export async function syncCalendarEvent(
  gateway: CalendarGateway,
  item: AcademicItem,
  dryRun: boolean,
  detectedAt = new Date().toISOString(),
  classSlots: readonly ClassSlot[] = [],
): Promise<CalendarSyncResult> {
  const desired = buildCalendarEvent(item, detectedAt, classSlots);
  const officialValue = item.officialDeadline ?? item.officialDate;
  if (!desired || !officialValue) return { action: 'SKIPPED_UNCONFIRMED' };
  const window = searchWindow(officialValue);
  const existing = await gateway.list(window.timeMin, window.timeMax, item.id);
  const current =
    existing.find((event) => event.id === item.calendarEventId) ??
    existing.find((event) => event.extendedProperties.private.uvvItemId === item.id);

  if (current && equivalent(current, desired)) return { action: 'UNCHANGED', eventId: current.id };
  if (current) {
    if (dryRun) return { action: 'WOULD_UPDATE', eventId: current.id };
    const updated = await gateway.update(current.id, desired);
    return { action: 'UPDATED', eventId: updated.id };
  }
  if (existing.some((event) => sameVisibleEvent(event, desired))) {
    return { action: 'SKIPPED_EQUIVALENT' };
  }
  if (dryRun) return { action: 'WOULD_CREATE' };
  const created = await gateway.insert(desired);
  return { action: 'CREATED', eventId: created.id };
}
