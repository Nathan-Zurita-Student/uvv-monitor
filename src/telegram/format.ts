import type { AcademicItem, ItemStatus, Urgency } from '../models/academic-item.js';

const urgencyLabels: Record<Urgency, string> = {
  OVERDUE: 'ATRASADO',
  TODAY: 'HOJE',
  NEXT_24_HOURS: 'PRÓXIMAS 24H',
  NEXT_72_HOURS: 'PRÓXIMAS 72H',
  THIS_WEEK: 'ESTA SEMANA',
  FUTURE: 'FUTURO',
  INFORMATIONAL: 'INFORMATIVO',
};

const statusLabels: Record<ItemStatus, string> = {
  TODO: 'NÃO INICIADO',
  IN_PROGRESS: 'EM ANDAMENTO',
  DONE: 'CONCLUÍDO',
  WAITING: 'AGUARDANDO',
  NEEDS_CONFIRMATION: 'PRECISA DE CONFIRMAÇÃO',
  IGNORED: 'IGNORADO',
};

export function formatNovelty(item: AcademicItem): string {
  const lines = [
    'NOVIDADE UVV',
    '',
    `🎓 Disciplina/origem: ${item.discipline ?? item.source}`,
    `📌 O que aconteceu: ${item.title}`,
    `✅ O que preciso fazer: ${item.description}`,
    `📅 Prazo/data oficial: ${item.officialDeadline ?? item.officialDate ?? 'Não informado'}`,
  ];
  if (item.metadata?.weight) lines.push(`📊 Peso/nota: ${item.metadata.weight}`);
  lines.push(
    `🔗 Link: ${item.sourceUrl}`,
    `⚠️ Urgência: ${urgencyLabels[item.urgency]}`,
    `🆔 ID: ${item.id}`,
  );
  return lines.join('\n');
}

export function formatPriorities(items: AcademicItem[]): string {
  const open = items.filter((item) => !['DONE', 'IGNORED'].includes(item.status));
  const lines = ['MINHAS PRIORIDADES'];
  for (const item of open) {
    lines.push(
      '',
      `${urgencyLabels[item.urgency]} — ${item.id} — ${item.title}`,
      `Prazo: ${item.officialDeadline ?? item.officialDate ?? 'sem data confirmada'}`,
      `Status: ${statusLabels[item.status]}`,
    );
  }
  return lines.join('\n');
}

export function formatProgressCheck(items: AcademicItem[]): string {
  const selected = items.filter((item) => item.status === 'TODO').slice(0, 3);
  if (selected.length === 0) return '';
  return [
    'Como está seu progresso?',
    ...selected.flatMap((item) => [
      '',
      `${item.id} — ${item.title}`,
      `/feito ${item.id}`,
      `/fazendo ${item.id}`,
      `/pendente ${item.id}`,
    ]),
  ].join('\n');
}

export function format72HourSummary(items: AcademicItem[]): string {
  const relevant = items.filter((item) =>
    ['OVERDUE', 'TODAY', 'NEXT_24_HOURS', 'NEXT_72_HOURS'].includes(item.urgency),
  );
  if (relevant.length === 0) return '';
  return [
    'PRÓXIMAS 72 HORAS — UVV',
    ...relevant.map(
      (item) =>
        `\n${item.id} — ${item.title}\n${item.officialDeadline ?? item.officialDate ?? ''}\nStatus: ${statusLabels[item.status]}`,
    ),
  ].join('\n');
}

export function formatWeeklyReview(items: AcademicItem[]): string {
  const open = items.filter((item) => !['DONE', 'IGNORED'].includes(item.status));
  const sections: Array<{ title: string; urgencies: Urgency[] }> = [
    { title: '🔴 URGENTE', urgencies: ['OVERDUE', 'TODAY', 'NEXT_24_HOURS'] },
    { title: '🟠 ESTA SEMANA', urgencies: ['NEXT_72_HOURS', 'THIS_WEEK'] },
    { title: '🟢 PODE SER ADIANTADO', urgencies: ['FUTURE'] },
    { title: '⚠️ PENDÊNCIAS / ATRASADAS', urgencies: ['OVERDUE'] },
  ];
  const lines = ['REVISÃO UVV — 7 DIAS'];
  for (const section of sections) {
    const entries = open.filter((item) => section.urgencies.includes(item.urgency));
    if (entries.length === 0) continue;
    lines.push('', section.title, ...entries.map((item) => `${item.id} — ${item.title}`));
  }
  return lines.join('\n');
}
