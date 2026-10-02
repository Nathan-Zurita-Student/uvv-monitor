import { itemTypes, type AcademicItem, type ItemType } from '../models/academic-item.js';
import { parseAcademicDate } from '../utils/dates.js';

export type FocusKind = 'EXAM' | 'TASK';

/** Origens estruturadas cujo tipo vem de dados oficiais e não deve ser reclassificado pela IA. */
const trustedOrigins = new Set(['OFFICIAL_EXAM_SCHEDULE', 'EAD', 'EAD_CALENDAR', 'CALENDAR']);
const taskTypes = new Set<ItemType>(['ASSIGNMENT', 'AOP', 'ACTIVITY']);

/**
 * Origem do item. O calendário oficial de provas chega como mensagem do Portal, então é
 * reconhecido pelo identificador externo e pelo campo ssessment.
 */
export function originOf(item: AcademicItem): string {
  if (item.externalId.startsWith('exam-schedule:') || item.metadata?.assessment) {
    return 'OFFICIAL_EXAM_SCHEDULE';
  }
  return item.metadata?.origin ?? item.source;
}

export function hasTrustedOrigin(item: AcademicItem): boolean {
  return trustedOrigins.has(originOf(item));
}

/** A IA classificou como propaganda, vaga, pesquisa opcional etc. */
export function isAiIrrelevant(item: AcademicItem): boolean {
  return !hasTrustedOrigin(item) && item.metadata?.aiRelevance === 'IRRELEVANT';
}

/** Tipo usado para decisões: o da IA corrige classificações por palavra-chave de fontes livres. */
export function effectiveType(item: AcademicItem): ItemType {
  const suggested = item.metadata?.aiSuggestedType;
  if (hasTrustedOrigin(item) || !suggested) return item.type;
  return (itemTypes as readonly string[]).includes(suggested) ? (suggested as ItemType) : item.type;
}

export function isOpen(item: AcademicItem): boolean {
  return !['DONE', 'IGNORED'].includes(item.status) && item.metadata?.contextOnly !== 'true';
}

export function focusKind(item: AcademicItem): FocusKind | undefined {
  if (!isOpen(item) || isAiIrrelevant(item)) return undefined;
  const type = effectiveType(item);
  if (type === 'EXAM') return 'EXAM';
  return taskTypes.has(type) ? 'TASK' : undefined;
}

export interface EffectiveDate {
  value: string;
  source: 'OFFICIAL' | 'AI';
  deadline: boolean;
}

/** Data oficial; na falta dela, a data que a IA encontrou literalmente no texto. */
export function effectiveDate(item: AcademicItem): EffectiveDate | undefined {
  if (item.officialDeadline)
    return { value: item.officialDeadline, source: 'OFFICIAL', deadline: true };
  if (item.officialDate) return { value: item.officialDate, source: 'OFFICIAL', deadline: false };
  const aiDate = item.metadata?.aiDueDate;
  if (aiDate && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/.test(aiDate)) {
    return { value: aiDate, source: 'AI', deadline: true };
  }
  return undefined;
}

export function dueInstant(date: EffectiveDate): Date {
  return parseAcademicDate(date.value, date.deadline);
}

const conditionalPattern =
  /\b(2[ªa°º]?\s*chamada|segunda chamada|prova final|exame final|recupera[çc][ãa]o)\b/i;

/** 2ª chamada, prova final e recuperação só acontecem se o aluno precisar. */
export function isConditionalExam(item: AcademicItem): boolean {
  const assessment = item.metadata?.assessment ?? '';
  return ['SECOND_CALL', 'FINAL'].includes(assessment) || conditionalPattern.test(item.title);
}

const monthAbbreviations = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];

/** Melhor estimativa da data de publicação (e-mail recebido, sufixo "16set" das mensagens do Portal). */
export function publishedAt(item: AcademicItem, now = new Date()): Date {
  const received = item.metadata?.receivedAt;
  if (received && !Number.isNaN(Date.parse(received))) return new Date(received);
  const suffix =
    originOf(item) === 'MESSAGE' ? /(\d{1,2})\s*([a-z]{3})\s*$/i.exec(item.title) : null;
  const month = suffix?.[2] ? monthAbbreviations.indexOf(suffix[2].toLowerCase()) : -1;
  if (suffix?.[1] && month >= 0) {
    const day = Number(suffix[1]);
    const candidate = new Date(Date.UTC(now.getUTCFullYear(), month, day, 15));
    if (candidate.getTime() > now.getTime() + 24 * 60 * 60_000) {
      candidate.setUTCFullYear(candidate.getUTCFullYear() - 1);
    }
    return candidate;
  }
  return new Date(item.firstSeenAt);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Título limpo para exibição, sem a disciplina repetida. */
export function displayTitle(item: AcademicItem): string {
  const aiTitle = hasTrustedOrigin(item) ? undefined : item.metadata?.aiDisplayTitle?.trim();
  let title = aiTitle ?? item.title;
  if (item.discipline) {
    title = title.replace(
      new RegExp(`\\s*[—–-]\\s*${escapeRegExp(item.discipline.trim())}\\s*$`, 'i'),
      '',
    );
  }
  return title
    .replace(/Atividade Online Pontuada/gi, 'AOP')
    .replace(/^[?�\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function disciplineKey(item: AcademicItem): string {
  return (item.discipline ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
