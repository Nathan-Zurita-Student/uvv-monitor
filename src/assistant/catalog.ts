import { findEntry, toAgendaEntry, type Agenda, type AgendaEntry } from '../agenda/agenda.js';
import { effectiveType, originOf, publishedAt } from '../agenda/focus.js';
import { activityFacts, itemLabel, shortDiscipline, studyTopics } from '../bot/activity.js';
import type { AcademicItem, ItemStatus } from '../models/academic-item.js';
import { hasExplicitTime, localDateKey } from '../utils/dates.js';
import { localDayMonth, localTime, weekdayLabel } from './dates.js';
import type { AcademicCategory, InfoSource } from './types.js';

/** Classifica cada item no vocabulário do aluno: prova, trabalho, AOP, aviso, estágio... */
export function academicCategory(item: AcademicItem): AcademicCategory {
  const type = effectiveType(item);
  const text = `${item.title} ${item.metadata?.aiDisplayTitle ?? ''}`
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
  if (type === 'EXAM') return 'prova';
  if (type === 'GRADE' || /\bnotas?\b.*(lancad|publicad|divulgad)/.test(text)) return 'nota';
  if (/\bestagio\b/.test(text)) return 'estagio';
  if (type === 'AOP' || /\baop\b|atividade online pontuada/.test(text)) return 'aop';
  if (/seminario/.test(text)) return 'seminario';
  if (/apresentac/.test(text)) return 'apresentacao';
  if (/\btrabalho|projeto\b/.test(text)) return 'trabalho';
  if (/exercicio|\blista\b|fixacao/.test(text)) return 'exercicio';
  if (type === 'CLASS' || type === 'SCHEDULE_CHANGE') return 'aula';
  if (type === 'SERVICE_REQUEST') return 'pendencia';
  if (type === 'DOCUMENT') return 'documento';
  if (type === 'ASSIGNMENT') return 'entrega';
  if (type === 'ACTIVITY') return 'atividade';
  return 'aviso';
}

/** De onde a informação veio, para aplicar a ordem de confiança. */
export function sourceOfItem(item: AcademicItem): InfoSource {
  const origin = originOf(item);
  if (item.source === 'USER') return 'usuario';
  if (item.source === 'GMAIL' || origin === 'GMAIL') return 'email';
  if (origin === 'EAD' || origin === 'EAD_CALENDAR') return 'ava';
  return 'portal';
}

const statusTexts: Record<ItemStatus, string> = {
  TODO: 'pendente',
  IN_PROGRESS: 'em andamento',
  DONE: 'concluída',
  WAITING: 'aguardando',
  NEEDS_CONFIRMATION: 'a confirmar',
  IGNORED: 'ignorada',
};

export interface AcademicSummary {
  id: string;
  label: string;
  category: AcademicCategory;
  discipline?: string;
  status: string;
  /** Data local "YYYY-MM-DD" e horário "HH:mm" (quando informado). */
  date?: string;
  time?: string;
  when?: string;
  daysLeft?: number;
  source: InfoSource;
  dateSource?: 'oficial' | 'inferida pela IA de um texto';
  points?: string;
  opensAt?: string;
  summary?: string;
  studyTopics?: string[];
  alsoSeenIn?: InfoSource[];
  userConfirmedStatus?: boolean;
}

function clean(text: string | undefined, max: number): string | undefined {
  const value = text?.replace(/\s+/g, ' ').trim();
  if (!value) return undefined;
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

/** Resumo compacto de uma entrada da agenda (prova/entrega) para o modelo. */
export function summarizeEntry(
  entry: AgendaEntry,
  now: Date,
  userStatusIds: ReadonlySet<string> = new Set(),
): AcademicSummary {
  const { item } = entry;
  const facts = activityFacts(entry);
  const overdue =
    entry.kind === 'TASK' &&
    entry.due !== undefined &&
    entry.due.getTime() < now.getTime() &&
    !['DONE', 'IGNORED'].includes(item.status);
  const timed = entry.date ? hasExplicitTime(entry.date.value) : false;
  const summary = clean(item.metadata?.aiSummary ?? item.description, 220);
  const topics = entry.kind === 'EXAM' ? studyTopics(entry).slice(0, 6) : [];
  const related = [...new Set(entry.related.map(sourceOfItem))].filter(
    (source) => source !== sourceOfItem(item),
  );
  const discipline = shortDiscipline(item.discipline);
  return {
    id: item.id,
    label: itemLabel(item),
    category: academicCategory(item),
    ...(discipline ? { discipline } : {}),
    status: overdue ? 'atrasada' : statusTexts[item.status],
    ...(entry.due
      ? {
          date: localDateKey(entry.due),
          ...(timed ? { time: localTime(entry.due) } : {}),
          when: `${weekdayLabel(entry.due)}, ${localDayMonth(entry.due)}${timed ? ` às ${localTime(entry.due)}` : entry.kind === 'EXAM' ? ' (horário não informado)' : ' (até o fim do dia)'}`,
          daysLeft: entry.days ?? 0,
        }
      : {}),
    source: sourceOfItem(item),
    ...(entry.date
      ? {
          dateSource:
            entry.date.source === 'AI'
              ? ('inferida pela IA de um texto' as const)
              : ('oficial' as const),
        }
      : {}),
    ...(facts.points ? { points: facts.points } : {}),
    ...(facts.opensAt && facts.opensAt.getTime() > now.getTime()
      ? { opensAt: localDateKey(facts.opensAt) }
      : {}),
    ...(summary ? { summary } : {}),
    ...(topics.length > 0 ? { studyTopics: topics } : {}),
    ...(related.length > 0 ? { alsoSeenIn: related } : {}),
    ...(userStatusIds.has(item.id) ? { userConfirmedStatus: true } : {}),
  };
}

/** Resumo de qualquer item (inclusive avisos, notas e concluídos, que ficam fora da agenda). */
export function summarizeItem(
  item: AcademicItem,
  agenda: Agenda,
  now: Date,
  userStatusIds: ReadonlySet<string> = new Set(),
): AcademicSummary {
  const fromAgenda = findEntry(agenda, item.id);
  const entry =
    fromAgenda && fromAgenda.item.id === item.id
      ? fromAgenda
      : (toAgendaEntry({ ...item, status: 'TODO' }, now) ?? undefined);
  if (entry) {
    const summary = summarizeEntry({ ...entry, item }, now, userStatusIds);
    return summary;
  }
  const discipline = shortDiscipline(item.discipline);
  const summary = clean(item.metadata?.aiSummary ?? item.description, 220);
  const published = publishedAt(item, now);
  return {
    id: item.id,
    label: itemLabel(item),
    category: academicCategory(item),
    ...(discipline ? { discipline } : {}),
    status: statusTexts[item.status],
    source: sourceOfItem(item),
    ...(summary ? { summary } : {}),
    when: `publicado em ${localDayMonth(published)}`,
    ...(userStatusIds.has(item.id) ? { userConfirmedStatus: true } : {}),
  };
}

/** Termos usados para casar eventos da Agenda com itens acadêmicos e blocos de estudo. */
export function matchTokens(value: string): Set<string> {
  return new Set(
    value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 4 && !ignoredTokens.has(token)),
  );
}

const ignoredTokens = new Set([
  'prova',
  'entrega',
  'atividade',
  'trabalho',
  'estudar',
  'estudo',
  'revisar',
  'revisao',
  'para',
  'online',
  'pontuada',
  'aula',
  'evento',
]);

export function sharesTokens(left: string, right: string): boolean {
  const tokens = matchTokens(left);
  return [...matchTokens(right)].some((token) => tokens.has(token));
}
