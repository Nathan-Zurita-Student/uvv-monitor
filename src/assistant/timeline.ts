import type { Agenda, AgendaEntry } from '../agenda/agenda.js';
import { itemLabel } from '../bot/activity.js';
import { hasExplicitTime, localDateKey } from '../utils/dates.js';
import { academicCategory, sharesTokens, sourceOfItem } from './catalog.js';
import { addDays, daysBetween, localTime, localWeekday, zonedInstant } from './dates.js';
import type { WeeklySlot } from './memory.js';
import type { AcademicCategory, CalendarEvent, InfoSource, PersonalReminder } from './types.js';

export type TimelineKind =
  'prova' | 'entrega' | 'aula' | 'compromisso' | 'estudo' | 'lembrete' | 'dia_inteiro';

export interface TimelineEntry {
  /** ID do item acadêmico, do evento da Agenda, do lembrete ou da memória. */
  id: string;
  date: string;
  start?: string;
  end?: string;
  title: string;
  kind: TimelineKind;
  source: InfoSource;
  status?: string;
  category?: AcademicCategory;
  notes?: string[];
  conditional?: boolean;
}

export interface TimelineInput {
  from: string;
  to: string;
  now: Date;
  agenda: Agenda;
  events?: CalendarEvent[];
  reminders?: PersonalReminder[];
  slots?: WeeklySlot[];
}

function academicEntries(agenda: Agenda): Array<AgendaEntry & { due: Date }> {
  return [...agenda.exams, ...agenda.conditionalExams, ...agenda.tasks, ...agenda.overdue].filter(
    (entry): entry is AgendaEntry & { due: Date } => entry.due !== undefined,
  );
}

function minutesOf(time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Tudo o que acontece entre `from` e `to` (dias locais, inclusive), sem duplicar o que aparece em
 * mais de uma fonte: o evento que o monitor criou para uma prova é a própria prova; um compromisso
 * do usuário com o mesmo assunto no mesmo dia vira uma observação na prova/entrega.
 */
export function buildTimeline(input: TimelineInput): TimelineEntry[] {
  const { from, to, now } = input;
  const inRange = (date: string) => date >= from && date <= to;
  const result: TimelineEntry[] = [];

  const academic = academicEntries(input.agenda).filter((entry) =>
    inRange(localDateKey(entry.due)),
  );
  const academicTimeline = academic.map((entry) => {
    const timed = entry.date ? hasExplicitTime(entry.date.value) : false;
    const overdue =
      entry.kind === 'TASK' &&
      entry.due.getTime() < now.getTime() &&
      !['DONE', 'IGNORED'].includes(entry.item.status);
    const timelineEntry: TimelineEntry = {
      id: entry.item.id,
      date: localDateKey(entry.due),
      ...(timed ? { start: localTime(entry.due) } : {}),
      title: itemLabel(entry.item),
      kind: entry.kind === 'EXAM' ? 'prova' : 'entrega',
      source: sourceOfItem(entry.item),
      status: overdue ? 'atrasada' : entry.item.status === 'TODO' ? 'pendente' : entry.item.status,
      category: academicCategory(entry.item),
      ...(entry.conditional ? { conditional: true } : {}),
      ...(entry.date?.source === 'AI' || (!timed && entry.kind === 'EXAM')
        ? {
            notes: [
              ...(entry.date?.source === 'AI'
                ? ['data lida pela IA em um texto, sem confirmação oficial']
                : []),
              ...(!timed && entry.kind === 'EXAM' ? ['horário não informado pela faculdade'] : []),
            ],
          }
        : {}),
    };
    return { entry, timelineEntry };
  });
  result.push(...academicTimeline.map(({ timelineEntry }) => timelineEntry));

  for (const event of input.events ?? []) {
    const date = localDateKey(event.start);
    if (!inRange(date) && !(event.allDay && localDateKey(event.end) > from && date < from))
      continue;
    // Eventos que o monitor sincronizou já estão representados pelo item acadêmico.
    if (event.academicItemId) continue;
    // Lembretes que a conversa antiga marcou na Agenda: um aviso num horário, não um compromisso.
    if (event.telegramReminder && !event.allDay) {
      result.push({
        id: event.id,
        date: inRange(date) ? date : from,
        start: localTime(event.start),
        title: event.title,
        kind: 'lembrete',
        source: 'agenda',
        notes: [
          `lembrete${event.urgent ? ' urgente' : ''} que você marcou na Agenda pelo Telegram`,
        ],
      });
      continue;
    }
    const twin = academicTimeline.find(
      ({ entry, timelineEntry }) =>
        timelineEntry.date === date &&
        (sharesTokens(event.title, `${entry.item.title} ${entry.item.discipline ?? ''}`) ||
          sharesTokens(event.title, timelineEntry.title)),
    );
    if (twin && !event.createdByAssistant) {
      const notes = twin.timelineEntry.notes ?? [];
      const eventTime = event.allDay ? undefined : localTime(event.start);
      notes.push(
        `também está na sua Agenda${eventTime ? ` às ${eventTime}` : ''} ("${event.title}")`,
      );
      if (
        eventTime &&
        twin.timelineEntry.start &&
        Math.abs(minutesOf(eventTime) - minutesOf(twin.timelineEntry.start)) >= 30
      ) {
        notes.push(
          `horários diferentes: Agenda ${eventTime}, ${twin.timelineEntry.source} ${twin.timelineEntry.start}; o que você anotou na Agenda costuma ser mais confiável`,
        );
      }
      twin.timelineEntry.notes = notes;
      continue;
    }
    const study = event.createdByAssistant && /📚|estud|revis/i.test(event.title);
    result.push({
      id: event.id,
      date: inRange(date) ? date : from,
      ...(event.allDay ? {} : { start: localTime(event.start), end: localTime(event.end) }),
      title: event.title,
      kind: event.allDay
        ? 'dia_inteiro'
        : study
          ? 'estudo'
          : /\baula\b/i.test(event.title)
            ? 'aula'
            : 'compromisso',
      source: 'agenda',
    });
  }

  // Aulas e rotinas da memória, quando a Agenda não tem o mesmo horário.
  const days = Math.max(0, daysBetween(from, to));
  for (let offset = 0; offset <= days && offset < 62; offset += 1) {
    const date = addDays(from, offset);
    const weekday = localWeekday(zonedInstant(date, '12:00'));
    for (const slot of input.slots ?? []) {
      if (slot.weekday !== weekday) continue;
      const duplicate = result.some(
        (entry) =>
          entry.date === date &&
          entry.start !== undefined &&
          Math.abs(minutesOf(entry.start) - minutesOf(slot.startTime)) < 30 &&
          (entry.kind === 'aula' || sharesTokens(entry.title, slot.title)),
      );
      if (duplicate) continue;
      result.push({
        id: slot.id,
        date,
        start: slot.startTime,
        end: slot.endTime,
        title: slot.title,
        kind: slot.category === 'aula' ? 'aula' : 'compromisso',
        source: 'memoria',
      });
    }
  }

  for (const reminder of input.reminders ?? []) {
    if (reminder.sentAt) continue;
    const at = new Date(reminder.remindAt);
    if (Number.isNaN(at.getTime())) continue;
    const date = localDateKey(at);
    if (!inRange(date)) continue;
    result.push({
      id: reminder.id,
      date,
      start: localTime(at),
      title: reminder.title,
      kind: 'lembrete',
      source: 'telegram',
      ...(reminder.urgent ? { notes: ['urgente'] } : {}),
    });
  }

  return result.sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      Number(left.kind !== 'dia_inteiro') - Number(right.kind !== 'dia_inteiro') ||
      (left.start ?? '99:99').localeCompare(right.start ?? '99:99'),
  );
}

/** Intervalos ocupados (aulas, compromissos, provas com horário) para o cálculo de horário livre. */
export function busyIntervals(
  timeline: TimelineEntry[],
): Array<{ start: Date; end: Date; title: string }> {
  return timeline.flatMap((entry) => {
    if (!entry.start || entry.kind === 'entrega' || entry.kind === 'lembrete') return [];
    const start = zonedInstant(entry.date, entry.start);
    const end = entry.end
      ? zonedInstant(entry.date, entry.end)
      : new Date(start.getTime() + (entry.kind === 'prova' ? 120 : 60) * 60_000);
    return end.getTime() > start.getTime() ? [{ start, end, title: entry.title }] : [];
  });
}

/** Dias locais entre hoje e `to`, para iterar períodos ("essa semana", "próximos 14 dias"). */
export function todayKey(now: Date): string {
  return localDateKey(now);
}

export { addDays };
