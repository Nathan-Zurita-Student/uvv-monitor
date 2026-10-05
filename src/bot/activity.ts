import type { AgendaEntry } from '../agenda/agenda.js';
import { displayTitle, originOf } from '../agenda/focus.js';
import type { AcademicItem } from '../models/academic-item.js';
import { ACADEMIC_TIMEZONE, hasExplicitTime, parseAcademicDate } from '../utils/dates.js';

function formatPart(date: Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: ACADEMIC_TIMEZONE, ...options }).format(date);
}

/** "13/10" */
export function dayMonth(date: Date): string {
  return formatPart(date, { day: '2-digit', month: '2-digit' });
}

/** "23:59" */
export function clock(date: Date): string {
  return formatPart(date, { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** "segunda" */
export function weekdayName(date: Date): string {
  return formatPart(date, { weekday: 'long' }).replace('-feira', '');
}

/** "13/10 às 23:59" ou "13/10" quando não há horário. */
export function whenText(value: string, deadline: boolean): string {
  const date = parseAcademicDate(value, deadline);
  return hasExplicitTime(value) ? `${dayMonth(date)} às ${clock(date)}` : dayMonth(date);
}

const connectors = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'para', 'a', 'o']);

/** "Aspectos Legais da Tecnologia da Informação" → "Aspectos Legais". */
export function shortDiscipline(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const cleaned = name
    .replace(/\s+-\s+.*$/, '')
    .replace(/tecnologia da informa[çc][ãa]o/i, 'TI')
    .replace(/^desenvolvimento\s+(de\s+)?/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const words: string[] = [];
  let significant = 0;
  for (const word of cleaned.split(' ')) {
    words.push(word);
    if (!connectors.has(word.toLowerCase())) significant += 1;
    if (significant === 2) break;
  }
  while (words.length > 1 && connectors.has((words[words.length - 1] ?? '').toLowerCase())) {
    words.pop();
  }
  const result = words.join(' ');
  return result.charAt(0).toUpperCase() + result.slice(1);
}

function bimester(title: string): string | undefined {
  return /([12])[ºo°]?\s*bim/i.exec(title)?.[1];
}

/** Nome curto exibido: "AOP 03 — Aspectos Legais" ou "Prova de Linguagens Formais". */
export function itemLabel(item: AcademicItem): string {
  const title = displayTitle(item);
  const discipline = shortDiscipline(item.discipline);
  if (!discipline) return title;
  if (/^prova\b/i.test(title) && !/chamada|final/i.test(title)) {
    const which = bimester(title);
    return which ? `Prova de ${discipline} (${which}º bim.)` : `Prova de ${discipline}`;
  }
  if (/2[ªa]\s*chamada/i.test(title)) return `2ª chamada de ${discipline}`;
  if (/prova final/i.test(title)) return `Prova final de ${discipline}`;
  return `${title} — ${discipline}`;
}

export function itemIcon(entryKind: AgendaEntry['kind'] | undefined): string {
  if (entryKind === 'EXAM') return '📚';
  if (entryKind === 'TASK') return '📝';
  return '📌';
}

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : [];
  } catch {
    return [];
  }
}

export function aiList(item: AcademicItem, key: string): string[] {
  return parseList(item.metadata?.[key]);
}

export function studyTopics(entry: AgendaEntry): string[] {
  for (const item of [entry.item, ...entry.related]) {
    const topics = aiList(item, 'aiStudyTopics');
    if (topics.length > 0) return topics;
  }
  return [];
}

export interface ActivityFacts {
  label: string;
  icon: string;
  /** "questionário", "entrega", "prova"... */
  noun: string;
  points?: string;
  opensAt?: Date;
  due?: Date;
  dueText?: string;
  tip?: string;
  openLabel: string;
}

function noun(entry: AgendaEntry): string {
  if (entry.kind === 'EXAM') return 'prova';
  const module = entry.item.metadata?.moodleModule;
  if (module === 'quiz') return 'questionário';
  if (module === 'assign') return 'entrega pelo AVA';
  if (module === 'forum') return 'participação no fórum';
  const title = entry.item.title.toLowerCase();
  if (/trabalho/.test(title)) return 'trabalho';
  if (/lista/.test(title)) return 'lista de exercícios';
  if (/semin[aá]rio|apresenta/.test(title)) return 'apresentação';
  return 'atividade';
}

function pointsOf(entry: AgendaEntry): string | undefined {
  for (const item of [entry.item, ...entry.related]) {
    if (item.metadata?.points) return item.metadata.points;
    const match = /vale(?:r[aá])?\s*(\d+(?:[.,]\d+)?)\s*pont/i.exec(item.description);
    if (match?.[1]) return match[1].replace('.', ',').replace(/,0+$/, '');
  }
  return undefined;
}

function opensAtOf(entry: AgendaEntry): Date | undefined {
  const value = [entry.item, ...entry.related].find((item) => item.metadata?.opensAt)?.metadata
    ?.opensAt;
  if (!value) return undefined;
  const date = parseAcademicDate(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function activityFacts(entry: AgendaEntry): ActivityFacts {
  const module = entry.item.metadata?.moodleModule;
  const points = pointsOf(entry);
  const opensAt = opensAtOf(entry);
  const tip =
    module === 'quiz'
      ? 'Quando terminar, lembre de clicar em "Finalizar tentativa" no AVA.'
      : module === 'assign'
        ? 'O envio é pelo próprio AVA, no link abaixo.'
        : undefined;
  const origin = originOf(entry.item);
  return {
    label: itemLabel(entry.item),
    icon: itemIcon(entry.kind),
    noun: noun(entry),
    ...(points ? { points } : {}),
    ...(opensAt ? { opensAt } : {}),
    ...(entry.due ? { due: entry.due } : {}),
    ...(entry.date
      ? { dueText: whenText(entry.date.value, entry.date.deadline || entry.kind === 'TASK') }
      : {}),
    ...(tip ? { tip } : {}),
    openLabel:
      origin === 'EAD' || origin === 'EAD_CALENDAR'
        ? '📖 Abrir atividade'
        : entry.item.source === 'GMAIL'
          ? '📖 Abrir e-mail'
          : '📖 Abrir no Portal',
  };
}

function article(nounText: string): string {
  return /^(prova|entrega|lista|atividade|participa|apresenta)/.test(nounText) ? 'uma' : 'um';
}

/**
 * Frase principal em linguagem natural, montada com os fatos confirmados.
 * Ex.: "É um questionário que vale 2 pontos e pode ser feito até 13/10 às 23:59."
 */
export function naturalSentence(entry: AgendaEntry, now: Date): string {
  const facts = activityFacts(entry);
  if (entry.kind === 'EXAM') {
    if (!entry.due || !facts.dueText) return 'A data dessa prova ainda não foi divulgada.';
    const which = bimester(entry.item.title);
    const subject = which ? `A prova do ${which}º bimestre` : 'A prova';
    const time = hasExplicitTime(entry.date?.value ?? '') ? ` às ${clock(entry.due)}` : '';
    return `${subject} é ${weekdayName(entry.due)}, ${dayMonth(entry.due)}${time}.`;
  }
  const worth = facts.points
    ? ` que vale ${facts.points} ${facts.points === '1' ? 'ponto' : 'pontos'}`
    : '';
  const opening =
    facts.opensAt && facts.opensAt.getTime() > now.getTime()
      ? ` Abre em ${dayMonth(facts.opensAt)}`
      : '';
  const feminine = article(facts.noun) === 'uma';
  const what = `É ${feminine ? 'uma' : 'um'} ${facts.noun}${worth}`;
  if (!facts.dueText) return `${what}. O prazo ainda não foi informado.`;
  if (opening) return `${what}.${opening} e vai até ${facts.dueText}.`;
  return `${what} e pode ser ${feminine ? 'feita' : 'feito'} até ${facts.dueText}.`;
}

/** Linha de contagem regressiva, mais enfática quanto mais perto do prazo. */
export function countdownLine(entry: AgendaEntry, now: Date): string | undefined {
  if (!entry.due || entry.days === undefined) return undefined;
  const time = hasExplicitTime(entry.date?.value ?? '') ? ` às ${clock(entry.due)}` : '';
  if (entry.due.getTime() < now.getTime() && entry.kind === 'TASK') {
    return entry.days === 0
      ? `🔴 O prazo terminou hoje${time}.`
      : `🔴 Venceu ${entry.days === -1 ? 'ontem' : `há ${String(-entry.days)} dias`}.`;
  }
  const verb = entry.kind === 'EXAM' ? 'É' : 'Vence';
  if (entry.days === 0) return `🚨 ${verb} hoje${time}.`;
  if (entry.days === 1) return `⚠️ ${verb} amanhã${time}.`;
  return `⏳ Faltam ${String(entry.days)} dias.`;
}
