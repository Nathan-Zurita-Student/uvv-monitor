import type { Agenda, AgendaEntry } from '../agenda/agenda.js';
import { activityFacts, itemLabel, shortDiscipline } from '../bot/activity.js';
import { hasExplicitTime, localDateKey } from '../utils/dates.js';
import { academicCategory, sharesTokens, summarizeEntry, type AcademicSummary } from './catalog.js';
import { localTime, weekdayLabel } from './dates.js';
import type { AcademicCategory, CalendarEvent, Insight } from './types.js';

const categoryWeight: Partial<Record<AcademicCategory, number>> = {
  prova: 10,
  trabalho: 8,
  seminario: 8,
  apresentacao: 8,
  aop: 7,
  entrega: 7,
  estagio: 7,
  documento: 6,
  pendencia: 6,
  exercicio: 5,
  atividade: 4,
};

function urgency(entry: AgendaEntry, now: Date): number {
  if (entry.days === undefined || !entry.due) return 0.35;
  if (entry.due.getTime() < now.getTime()) return entry.days >= -7 ? 1.6 : 0.4;
  if (entry.days <= 0) return 1.5;
  if (entry.days === 1) return 1.35;
  if (entry.days === 2) return 1.2;
  if (entry.days === 3) return 1.05;
  if (entry.days <= 5) return 0.9;
  if (entry.days <= 7) return 0.75;
  if (entry.days <= 14) return 0.5;
  return 0.3;
}

function dueReason(entry: AgendaEntry, now: Date): string {
  if (!entry.due || entry.days === undefined) return 'sem data definida';
  const time = entry.date && hasExplicitTime(entry.date.value) ? ` às ${localTime(entry.due)}` : '';
  if (entry.kind === 'TASK' && entry.due.getTime() < now.getTime()) {
    return entry.days === 0
      ? 'o prazo terminou hoje'
      : `atrasada há ${String(-entry.days)} ${entry.days === -1 ? 'dia' : 'dias'}`;
  }
  const verb = entry.kind === 'EXAM' ? 'é' : 'vence';
  if (entry.days === 0) return `${verb} hoje${time}`;
  if (entry.days === 1) return `${verb} amanhã${time}`;
  return `${entry.kind === 'EXAM' ? 'prova' : 'prazo'} em ${String(entry.days)} dias (${weekdayLabel(entry.due)})`;
}

export interface PriorityEntry {
  item: AcademicSummary;
  score: number;
  reasons: string[];
}

/**
 * Prioridade combinando prazo, tipo (prova pesa mais), pontos, atraso e quantos prazos se
 * acumulam no mesmo período. O modelo usa as razões para explicar a recomendação.
 */
export function prioritize(agenda: Agenda, now: Date, horizonDays = 14): PriorityEntry[] {
  const candidates = [
    ...agenda.overdue.filter((entry) => (entry.days ?? 0) >= -7),
    ...agenda.exams.filter((entry) => (entry.days ?? 99) <= horizonDays),
    ...agenda.tasks.filter((entry) => (entry.days ?? 99) <= horizonDays),
    ...agenda.undated.slice(0, 5),
  ];
  return candidates
    .map((entry) => {
      const category = academicCategory(entry.item);
      const facts = activityFacts(entry);
      const points = Number((facts.points ?? '').replace(',', '.'));
      const neighbors = candidates.filter(
        (other) =>
          other !== entry &&
          other.days !== undefined &&
          entry.days !== undefined &&
          Math.abs(other.days - entry.days) <= 1,
      ).length;
      let score = (categoryWeight[category] ?? 3) * urgency(entry, now);
      const reasons = [dueReason(entry, now)];
      if (Number.isFinite(points) && points > 0) {
        score += Math.min(points, 5) * 0.4;
        reasons.push(`vale ${facts.points} ${points === 1 ? 'ponto' : 'pontos'}`);
      }
      if (neighbors > 0) {
        score += Math.min(neighbors, 3) * 0.5;
        reasons.push(`${String(neighbors)} outro(s) prazo(s) perto dessa data`);
      }
      if (entry.conditional) score *= 0.3;
      if (entry.item.status === 'IN_PROGRESS') reasons.push('você já começou');
      return {
        item: summarizeEntry(entry, now),
        score: Math.round(score * 10) / 10,
        reasons,
      };
    })
    .sort((left, right) => right.score - left.score);
}

function hasStudyBefore(entry: AgendaEntry, events: CalendarEvent[], now: Date): boolean {
  const discipline = `${entry.item.discipline ?? ''} ${shortDiscipline(entry.item.discipline) ?? ''}`;
  return events.some(
    (event) =>
      event.start.getTime() >= now.getTime() - 3 * 86_400_000 &&
      event.start.getTime() < (entry.due?.getTime() ?? 0) &&
      !event.academicItemId &&
      (sharesTokens(event.title, discipline) || sharesTokens(event.title, itemLabel(entry.item))),
  );
}

function names(entries: AgendaEntry[]): string {
  const labels = entries.map((entry) => itemLabel(entry.item));
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} e ${labels[labels.length - 1] ?? ''}`;
}

const countWords = ['zero', 'uma', 'duas', 'três', 'quatro', 'cinco', 'seis'];

/**
 * Situações que merecem um aviso curto: prazo vencendo com a tarefa pendente, prova chegando sem
 * estudo marcado na Agenda, entregas no mesmo dia, compromissos sobrepostos e semana apertada.
 * `events` indefinido significa que a Agenda não foi consultada.
 */
export function computeInsights(input: {
  agenda: Agenda;
  now: Date;
  events?: CalendarEvent[];
}): Insight[] {
  const { agenda, now, events } = input;
  const insights: Insight[] = [];
  const pending = (entry: AgendaEntry) =>
    ['TODO', 'IN_PROGRESS', 'WAITING'].includes(entry.item.status);

  for (const entry of agenda.tasks) {
    if (!entry.due || entry.days === undefined || entry.days > 1 || !pending(entry)) continue;
    const time =
      entry.date && hasExplicitTime(entry.date.value) ? ` às ${localTime(entry.due)}` : '';
    insights.push({
      key: `due:${entry.item.id}:${localDateKey(entry.due)}`,
      kind: 'due_soon',
      text: `${itemLabel(entry.item)} vence ${entry.days <= 0 ? 'hoje' : 'amanhã'}${time} e ainda está como pendente.`,
      itemIds: [entry.item.id],
      severity: entry.days <= 0 ? 10 : 8,
    });
  }
  for (const entry of agenda.overdue) {
    if ((entry.days ?? -99) < -3 || !pending(entry)) continue;
    insights.push({
      key: `overdue:${entry.item.id}`,
      kind: 'overdue',
      text: `${itemLabel(entry.item)} venceu ${entry.days === 0 ? 'hoje' : entry.days === -1 ? 'ontem' : `há ${String(-(entry.days ?? 0))} dias`} e ainda aparece como pendente. Se já entregou, é só me avisar que eu marco como concluída.`,
      itemIds: [entry.item.id],
      severity: 9,
    });
  }
  for (const entry of agenda.exams) {
    if (!entry.due || entry.days === undefined || entry.days < 1 || entry.days > 3) continue;
    const when =
      entry.days === 1 ? 'amanhã' : `daqui a ${countWords[entry.days] ?? entry.days} dias`;
    const studied = events ? hasStudyBefore(entry, events, now) : undefined;
    if (studied === true) continue;
    insights.push({
      key: `exam:${entry.item.id}:${String(entry.days)}`,
      kind: studied === false ? 'exam_without_study' : 'exam_soon',
      text:
        studied === false
          ? `Sua ${itemLabel(entry.item)} é ${when} e não encontrei nenhum horário de estudo marcado na Agenda.`
          : `Sua ${itemLabel(entry.item)} é ${when}.`,
      itemIds: [entry.item.id],
      severity: entry.days === 1 ? 9 : 7,
    });
  }

  const nextWeek = [...agenda.exams, ...agenda.tasks].filter(
    (entry) => entry.days !== undefined && entry.days >= 0 && entry.days <= 7 && pending(entry),
  );
  const byDay = new Map<string, AgendaEntry[]>();
  for (const entry of nextWeek) {
    const key = localDateKey(entry.due!);
    byDay.set(key, [...(byDay.get(key) ?? []), entry]);
  }
  for (const [day, entries] of byDay) {
    if (entries.length < 2) continue;
    const exams = entries.filter((entry) => entry.kind === 'EXAM');
    const tasks = entries.filter((entry) => entry.kind === 'TASK');
    const weekday = weekdayLabel(entries[0]!.due!);
    const text =
      exams.length > 0 && tasks.length > 0
        ? `Na ${weekday} tem ${names(exams)} e também ${tasks.length === 1 ? 'a entrega de ' : 'as entregas de '}${names(tasks)}. Vale adiantar a entrega antes.`
        : exams.length > 1
          ? `Na ${weekday} você tem ${countWords[exams.length] ?? exams.length} provas: ${names(exams)}.`
          : `Você tem ${countWords[tasks.length] ?? tasks.length} entregas na ${weekday} (${names(tasks)}). Talvez seja melhor adiantar uma delas.`;
    insights.push({
      key: `day:${day}:${entries
        .map((entry) => entry.item.id)
        .sort()
        .join(',')}`,
      kind: 'same_day',
      text,
      itemIds: entries.map((entry) => entry.item.id),
      severity: 6,
    });
  }

  const soon = nextWeek.filter((entry) => (entry.days ?? 99) <= 3);
  if (soon.length >= 3) {
    insights.push({
      key: `crunch:${localDateKey(now)}:${String(soon.length)}`,
      kind: 'crunch',
      text: `Os próximos três dias estão apertados: são ${String(soon.length)} prazos e provas.`,
      itemIds: soon.map((entry) => entry.item.id),
      severity: 5,
    });
  }

  if (events) {
    const timed = events
      .filter((event) => !event.allDay && event.start.getTime() >= now.getTime())
      .filter((event) => event.start.getTime() < now.getTime() + 7 * 86_400_000)
      .sort((left, right) => left.start.getTime() - right.start.getTime());
    for (let index = 0; index < timed.length; index += 1) {
      const current = timed[index]!;
      const next = timed[index + 1];
      if (!next || next.start.getTime() >= current.end.getTime()) continue;
      if (current.academicItemId && next.academicItemId) continue;
      insights.push({
        key: `overlap:${current.id}:${next.id}`,
        kind: 'overlap',
        text: `Na ${weekdayLabel(current.start)}, "${current.title}" (${localTime(current.start)}) e "${next.title}" (${localTime(next.start)}) se sobrepõem.`,
        itemIds: [],
        severity: 6,
      });
    }
  }

  return insights.sort((left, right) => right.severity - left.severity);
}
