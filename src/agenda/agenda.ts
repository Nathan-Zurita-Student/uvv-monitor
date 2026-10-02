import type { AcademicItem } from '../models/academic-item.js';
import { calendarDaysUntil, localDateKey } from '../utils/dates.js';
import {
  disciplineKey,
  dueInstant,
  effectiveDate,
  effectiveType,
  focusKind,
  isAiIrrelevant,
  isConditionalExam,
  isOpen,
  originOf,
  publishedAt,
  type EffectiveDate,
  type FocusKind,
} from './focus.js';

export interface AgendaEntry {
  item: AcademicItem;
  kind: FocusKind;
  date?: EffectiveDate;
  due?: Date;
  /** Dias de calendário até a data; negativo quando já passou. */
  days?: number;
  conditional: boolean;
  /** Outras fontes que descrevem a mesma prova/entrega. */
  related: AcademicItem[];
}

export interface Agenda {
  now: Date;
  exams: AgendaEntry[];
  conditionalExams: AgendaEntry[];
  tasks: AgendaEntry[];
  overdue: AgendaEntry[];
  undated: AgendaEntry[];
  otherPending: AcademicItem[];
}

/** Tarefas vencidas há mais tempo que isso deixam de aparecer como atrasadas. */
const overdueWindowDays = 30;
/** Itens sem data publicados há mais tempo que isso são considerados antigos. */
const undatedWindowDays = 45;

const originRank: Record<string, number> = {
  OFFICIAL_EXAM_SCHEDULE: 5,
  EAD: 4,
  EAD_CALENDAR: 4,
  CALENDAR: 3,
  CLASS_POST: 2,
  MESSAGE: 1,
};

function rank(item: AcademicItem): number {
  return (originRank[originOf(item)] ?? 0) * 2 + (item.metadata?.aiSummary ? 1 : 0);
}

export function toAgendaEntry(item: AcademicItem, now: Date): AgendaEntry | undefined {
  const kind = focusKind(item);
  if (!kind) return undefined;
  const date = effectiveDate(item);
  const conditional = kind === 'EXAM' && isConditionalExam(item);
  if (!date) return { item, kind, conditional, related: [] };
  // Uma entrega com apenas o dia informado vale até o fim desse dia.
  const due = dueInstant(kind === 'TASK' ? { ...date, deadline: true } : date);
  if (Number.isNaN(due.getTime())) return { item, kind, conditional, related: [] };
  return { item, kind, date, due, days: calendarDaysUntil(due, now), conditional, related: [] };
}

function significantTokens(value: string): Set<string> {
  return new Set(
    value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 5),
  );
}

function numbersIn(value: string): string {
  return [...value.matchAll(/\d+/g)]
    .map((match) => String(Number(match[0])))
    .sort()
    .join(',');
}

/** Mesma entrega vista por fontes diferentes (ex.: calendário e post), nunca "AOP 01" x "AOP 02". */
function sameSubject(left: AcademicItem, right: AcademicItem): boolean {
  if (originOf(left) === originOf(right)) {
    return false;
  }
  const leftNumbers = numbersIn(left.title);
  const rightNumbers = numbersIn(right.title);
  if (leftNumbers && rightNumbers && leftNumbers !== rightNumbers) return false;
  const tokens = significantTokens(left.title);
  return [...significantTokens(right.title)].some((token) => tokens.has(token));
}

const structuredUndatedOrigins = new Set([
  'OFFICIAL_EXAM_SCHEDULE',
  'EAD',
  'CALENDAR',
  'CLASS_POST',
]);

/** Sem data, só mostra o que veio de fonte estruturada ou que a IA confirmou exigir ação. */
function isReliableUndated(item: AcademicItem): boolean {
  return (
    structuredUndatedOrigins.has(originOf(item)) || item.metadata?.aiRelevance === 'ACTION_REQUIRED'
  );
}

/** Une entradas que descrevem a mesma prova (mesma disciplina e dia) ou a mesma entrega. */
function mergeDuplicates(entries: AgendaEntry[]): AgendaEntry[] {
  const merged: AgendaEntry[] = [];
  for (const entry of [...entries].sort((left, right) => rank(right.item) - rank(left.item))) {
    const day = entry.due ? localDateKey(entry.due) : undefined;
    const discipline = disciplineKey(entry.item);
    const twin = merged.find(
      (candidate) =>
        candidate.kind === entry.kind &&
        (candidate.due ? localDateKey(candidate.due) : undefined) === day &&
        disciplineKey(candidate.item) === discipline &&
        discipline !== '' &&
        (entry.kind === 'EXAM' || sameSubject(candidate.item, entry.item)),
    );
    if (twin) twin.related.push(entry.item);
    else merged.push(entry);
  }
  return merged;
}

const byDueAscending = (left: AgendaEntry, right: AgendaEntry) =>
  (left.due?.getTime() ?? 0) - (right.due?.getTime() ?? 0);

export function buildAgenda(items: AcademicItem[], now = new Date()): Agenda {
  const exams: AgendaEntry[] = [];
  const conditionalExams: AgendaEntry[] = [];
  const tasks: AgendaEntry[] = [];
  const overdue: AgendaEntry[] = [];
  const undated: AgendaEntry[] = [];

  for (const item of items) {
    const entry = toAgendaEntry(item, now);
    if (!entry) continue;
    if (!entry.due || entry.days === undefined) {
      const ageDays = calendarDaysUntil(now, publishedAt(item, now));
      if (ageDays <= undatedWindowDays && isReliableUndated(item)) undated.push(entry);
      continue;
    }
    if (entry.kind === 'EXAM') {
      if (entry.days < 0) continue; // a prova já aconteceu
      (entry.conditional ? conditionalExams : exams).push(entry);
      continue;
    }
    if (entry.due.getTime() < now.getTime()) {
      if (entry.days >= -overdueWindowDays) overdue.push(entry);
      continue;
    }
    tasks.push(entry);
  }

  const otherPending = items.filter((item) => {
    if (!isOpen(item) || isAiIrrelevant(item) || focusKind(item)) return false;
    if (!['DOCUMENT', 'SERVICE_REQUEST'].includes(effectiveType(item))) return false;
    const date = effectiveDate(item);
    if (date) return calendarDaysUntil(dueInstant(date), now) >= 0;
    return calendarDaysUntil(now, publishedAt(item, now)) <= undatedWindowDays;
  });

  return {
    now,
    exams: mergeDuplicates(exams).sort(byDueAscending),
    conditionalExams: mergeDuplicates(conditionalExams).sort(byDueAscending),
    tasks: mergeDuplicates(tasks).sort(byDueAscending),
    overdue: mergeDuplicates(overdue).sort((left, right) => byDueAscending(right, left)),
    undated: undated.sort(
      (left, right) =>
        publishedAt(right.item, now).getTime() - publishedAt(left.item, now).getTime(),
    ),
    otherPending,
  };
}

/** Provas e entregas dos próximos `days` dias (inclusive hoje), em ordem cronológica. */
export function upcoming(agenda: Agenda, days: number): AgendaEntry[] {
  return [...agenda.exams, ...agenda.tasks]
    .filter((entry) => entry.days !== undefined && entry.days <= days)
    .sort(byDueAscending);
}

const checkinStatuses = new Set(['TODO', 'IN_PROGRESS', 'WAITING', 'NEEDS_CONFIRMATION']);

/** Até `limit` itens que merecem uma pergunta de andamento: atrasados recentes e próximos 3 dias. */
export function selectCheckins(
  agenda: Agenda,
  exclude: ReadonlySet<string>,
  limit = 3,
): AgendaEntry[] {
  return [...agenda.overdue.filter((entry) => (entry.days ?? 0) >= -7), ...upcoming(agenda, 3)]
    .filter((entry) => checkinStatuses.has(entry.item.status) && !exclude.has(entry.item.id))
    .slice(0, limit);
}

/** Primeira entrada da agenda para um item (ou para algum item relacionado a ele). */
export function findEntry(agenda: Agenda, itemId: string): AgendaEntry | undefined {
  return [
    ...agenda.exams,
    ...agenda.conditionalExams,
    ...agenda.tasks,
    ...agenda.overdue,
    ...agenda.undated,
  ].find(
    (entry) => entry.item.id === itemId || entry.related.some((related) => related.id === itemId),
  );
}
