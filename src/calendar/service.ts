import type { AcademicItem } from '../models/academic-item.js';
import { normalizeText, stableStringify } from '../utils/normalize.js';
import type { CalendarEventDate, CalendarEventInput, CalendarGateway } from './types.js';

export type CalendarSyncResult =
  | { action: 'SKIPPED_UNCONFIRMED' }
  | { action: 'UNCHANGED'; eventId: string }
  | { action: 'WOULD_CREATE' }
  | { action: 'WOULD_UPDATE'; eventId: string }
  | { action: 'CREATED'; eventId: string }
  | { action: 'UPDATED'; eventId: string };

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

export function buildCalendarEvent(
  item: AcademicItem,
  detectedAt: string,
): CalendarEventInput | undefined {
  const officialValue = item.officialDeadline ?? item.officialDate;
  if (!officialValue || item.status === 'NEEDS_CONFIRMATION') return undefined;
  const dates = eventDate(officialValue, Boolean(item.officialDeadline));
  return {
    summary: eventTitle(item),
    description: [
      `Origem: ${item.source}`,
      `Disciplina: ${item.discipline ?? 'Não informada'}`,
      `Link da fonte: ${item.sourceUrl}`,
      `Prazo oficial: ${officialValue}`,
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

function equivalent(left: CalendarEventInput, right: CalendarEventInput): boolean {
  const comparable = (event: CalendarEventInput) => ({
    summary: normalizeText(event.summary),
    description: normalizeText(event.description),
    start: event.start,
    end: event.end,
    itemId: event.extendedProperties.private.uvvItemId,
    contentHash: event.extendedProperties.private.uvvContentHash,
  });
  return stableStringify(comparable(left)) === stableStringify(comparable(right));
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
): Promise<CalendarSyncResult> {
  const desired = buildCalendarEvent(item, detectedAt);
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
  if (dryRun) return { action: 'WOULD_CREATE' };
  const created = await gateway.insert(desired);
  return { action: 'CREATED', eventId: created.id };
}
