import { z } from 'zod';
import type { Agenda, AgendaEntry } from '../agenda/agenda.js';
import { displayTitle } from '../agenda/focus.js';
import { formatLongDay, formatShortDate, relativeDayLabel } from '../utils/dates.js';
import { redactAcademicText } from './prompt.js';
import type { AiProvider } from './types.js';

export interface FocusSuggestion {
  itemId: string;
  action: string;
}

const focusSchema = z.object({
  focus: z
    .array(z.object({ itemId: z.string().trim(), action: z.string().trim().min(1) }))
    .default([]),
});

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

export function studyTopics(entry: AgendaEntry): string[] {
  for (const item of [entry.item, ...entry.related]) {
    const topics = parseList(item.metadata?.aiStudyTopics);
    if (topics.length > 0) return topics;
  }
  return [];
}

/** Entradas que podem ser foco amanhã: provas em até 14 dias, entregas em até 10 e atrasos recentes. */
export function focusCandidates(agenda: Agenda): AgendaEntry[] {
  return [
    ...agenda.overdue.filter((entry) => (entry.days ?? 0) >= -7),
    ...agenda.exams.filter((entry) => (entry.days ?? 99) <= 14),
    ...agenda.tasks.filter((entry) => (entry.days ?? 99) <= 10),
  ].filter((entry) => entry.item.status !== 'DONE');
}

function describe(entry: AgendaEntry): string {
  const kind = entry.kind === 'EXAM' ? 'PROVA' : 'ENTREGA';
  const when = entry.date
    ? `${formatShortDate(entry.date.value, entry.date.deadline)} (${relativeDayLabel(entry.days ?? 0)})`
    : 'sem data';
  const topics = studyTopics(entry).slice(0, 6).join('; ');
  return [
    `- id=${entry.item.id} | ${kind} | ${redactAcademicText(displayTitle(entry.item))}`,
    `disciplina=${entry.item.discipline ?? 'não informada'}`,
    `quando=${when}`,
    `andamento=${entry.item.status}`,
    ...(topics ? [`conteúdo=${redactAcademicText(topics)}`] : []),
  ].join(' | ');
}

export function buildFocusPrompt(entries: AgendaEntry[], now: Date): string {
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60_000);
  return `Você ajuda um estudante universitário a decidir no que focar amanhã (${formatLongDay(tomorrow)}).

Pendências reais (use somente estas):
${entries.map(describe).join('\n')}

Regras:
- Escolha no máximo 3 pendências, da mais importante para a menos importante.
- Priorize provas próximas, entregas que vencem primeiro e atrasos recentes.
- action: frase curta e concreta (até 110 caracteres) começando com verbo no infinitivo. Cite conteúdos somente se aparecerem em "conteúdo".
- Não invente datas, conteúdos ou pendências.
- Responda exclusivamente JSON válido: {"focus":[{"itemId":"UVV-...","action":"..."}]}`;
}

export async function suggestTomorrowFocus(
  provider: AiProvider,
  agenda: Agenda,
): Promise<FocusSuggestion[]> {
  const entries = focusCandidates(agenda);
  if (entries.length === 0) return [];
  const parsed = focusSchema.parse(
    await provider.generateJson(buildFocusPrompt(entries, agenda.now)),
  );
  const known = new Set(entries.map((entry) => entry.item.id));
  const seen = new Set<string>();
  return parsed.focus
    .filter((entry) => known.has(entry.itemId) && !seen.has(entry.itemId) && seen.add(entry.itemId))
    .slice(0, 3)
    .map((entry) => ({ itemId: entry.itemId, action: entry.action.slice(0, 160) }));
}

/** Sugestão sem IA: provas de até 3 dias, entregas de até 2 dias, atrasos e trabalhos em andamento. */
export function defaultTomorrowFocus(agenda: Agenda): FocusSuggestion[] {
  const candidates = focusCandidates(agenda);
  const pick = (
    predicate: (entry: AgendaEntry) => boolean,
    action: (entry: AgendaEntry) => string,
  ) =>
    candidates.filter(predicate).map((entry) => ({ itemId: entry.item.id, action: action(entry) }));
  const suggestions = [
    ...pick(
      (entry) => entry.kind === 'EXAM' && (entry.days ?? 99) <= 3,
      (entry) => {
        const topics = studyTopics(entry).slice(0, 3).join(', ');
        return topics ? `Revisar ${topics}` : 'Revisar o conteúdo da prova';
      },
    ),
    ...pick(
      (entry) => entry.kind === 'TASK' && (entry.days ?? 99) >= 0 && (entry.days ?? 99) <= 2,
      () => 'Finalizar e entregar',
    ),
    ...pick(
      (entry) => (entry.days ?? 0) < 0,
      () => 'Verificar se ainda é possível entregar',
    ),
    ...pick(
      (entry) => entry.kind === 'TASK' && entry.item.status === 'IN_PROGRESS',
      () => 'Avançar no trabalho',
    ),
    ...pick(
      (entry) => entry.kind === 'EXAM' && (entry.days ?? 99) <= 7,
      () => 'Começar a revisar o conteúdo',
    ),
  ];
  const seen = new Set<string>();
  return suggestions
    .filter((entry) => !seen.has(entry.itemId) && seen.add(entry.itemId))
    .slice(0, 3);
}
