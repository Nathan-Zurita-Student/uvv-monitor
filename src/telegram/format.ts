import type { AcademicItem, ItemStatus, Urgency } from '../models/academic-item.js';
import { ACADEMIC_TIMEZONE, parseAcademicDate } from '../utils/dates.js';

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
  TODO: 'Ainda não comecei',
  IN_PROGRESS: 'Estou fazendo',
  DONE: 'Concluída',
  WAITING: 'Aguardando outra pessoa ou resposta',
  NEEDS_CONFIRMATION: 'Preciso confirmar essa informação',
  IGNORED: 'Ignorada',
};

const urgencyIcons: Record<Urgency, string> = {
  OVERDUE: '🔴',
  TODAY: '🔴',
  NEXT_24_HOURS: '🟠',
  NEXT_72_HOURS: '🟠',
  THIS_WEEK: '🟡',
  FUTURE: '🟢',
  INFORMATIONAL: 'ℹ️',
};

function cleanText(value: string, maxLength = 180): string {
  const cleaned = value
    .replace(/^[?\uFFFD\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1).trimEnd()}…` : cleaned;
}

function formatAcademicDate(value?: string): string {
  if (!value) return 'Data ainda não confirmada';
  const parsed = parseAcademicDate(value, false);
  if (Number.isNaN(parsed.getTime())) return 'Data ainda não confirmada';
  const date = new Intl.DateTimeFormat('pt-BR', {
    timeZone: ACADEMIC_TIMEZONE,
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(parsed);
  if (!/T\d{2}:\d{2}/.test(value)) return date;
  const time = new Intl.DateTimeFormat('pt-BR', {
    timeZone: ACADEMIC_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(parsed)
    .replace(':', 'h');
  return `${date}, às ${time}`;
}

function isActionable(item: AcademicItem): boolean {
  return (
    !['DONE', 'IGNORED'].includes(item.status) &&
    item.urgency !== 'INFORMATIONAL' &&
    item.metadata?.contextOnly !== 'true'
  );
}

function disciplineLine(item: AcademicItem): string {
  return `🎓 ${cleanText(item.discipline ?? (item.source === 'GMAIL' ? 'E-mail da UVV' : 'Portal UVV'))}`;
}

function sourceLinkLine(item: AcademicItem): string {
  const label = item.source === 'PORTAL' ? 'Abrir no Portal UVV' : 'Abrir informação original';
  return `🔗 ${label}: ${item.sourceUrl}`;
}

export function formatNovelty(item: AcademicItem): string {
  const lines = [
    'NOVIDADE UVV',
    '',
    `📌 ${cleanText(item.title)}`,
    disciplineLine(item),
    '',
    `O que foi informado: ${cleanText(item.description, 500)}`,
    `📅 Data oficial: ${formatAcademicDate(item.officialDeadline ?? item.officialDate)}`,
  ];
  if (item.metadata?.weight) lines.push(`📊 Peso/nota: ${item.metadata.weight}`);
  lines.push(
    `${urgencyIcons[item.urgency]} Prioridade: ${urgencyLabels[item.urgency]}`,
    `🔗 Ver informação original: ${item.sourceUrl}`,
    `🆔 Código: ${item.id}`,
  );
  return lines.join('\n');
}

export function formatPriorities(items: AcademicItem[]): string {
  const actionable = items.filter(isActionable);
  if (actionable.length === 0) return '';
  const visible = actionable.slice(0, 6);
  const lines = [
    'MINHAS PRIORIDADES',
    '',
    actionable.length === 1
      ? 'Encontrei 1 tarefa que merece sua atenção agora.'
      : `Encontrei ${String(actionable.length)} tarefas que merecem sua atenção agora. Estas são as mais importantes:`,
  ];
  for (const item of visible) {
    lines.push(
      '',
      `${urgencyIcons[item.urgency]} ${cleanText(item.title)}`,
      disciplineLine(item),
      `📅 Prazo: ${formatAcademicDate(item.officialDeadline ?? item.officialDate)}`,
      `⚠️ Prioridade: ${urgencyLabels[item.urgency]}`,
      `📊 Seu andamento: ${statusLabels[item.status]}`,
      sourceLinkLine(item),
      `🆔 Código: ${item.id}`,
    );
  }
  const hidden = actionable.length - visible.length;
  if (hidden > 0)
    lines.push('', `Mais ${String(hidden)} tarefa(s) ficaram fora deste resumo curto.`);
  lines.push('', 'Logo abaixo, vou perguntar sobre até 3 tarefas. Basta tocar em um botão.');
  return lines.join('\n');
}

export function formatProgressCheck(item: AcademicItem): string {
  return [
    'COMO ESTÁ ESSA TAREFA?',
    '',
    `📌 ${cleanText(item.title)}`,
    disciplineLine(item),
    `📅 Prazo: ${formatAcademicDate(item.officialDeadline ?? item.officialDate)}`,
    `📊 Situação atual: ${statusLabels[item.status]}`,
    sourceLinkLine(item),
    '',
    'Use um dos botões do teclado abaixo. Sua escolha aparecerá no chat e será confirmada na próxima verificação do monitor.',
  ].join('\n');
}

export function format72HourSummary(items: AcademicItem[]): string {
  const relevant = items
    .filter(
      (item) =>
        isActionable(item) &&
        ['OVERDUE', 'TODAY', 'NEXT_24_HOURS', 'NEXT_72_HOURS'].includes(item.urgency),
    )
    .slice(0, 8);
  if (relevant.length === 0) return '';
  return [
    'PRÓXIMAS 72 HORAS — UVV',
    '',
    'Isto é o que precisa da sua atenção primeiro:',
    ...relevant.map(
      (item) =>
        `\n${urgencyIcons[item.urgency]} ${cleanText(item.title)}\n📅 ${formatAcademicDate(item.officialDeadline ?? item.officialDate)}\n📊 ${statusLabels[item.status]}\n🆔 ${item.id}`,
    ),
  ].join('\n');
}

export function formatWeeklyReview(items: AcademicItem[]): string {
  const open = items.filter(isActionable);
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
    lines.push(
      '',
      section.title,
      ...entries
        .slice(0, 6)
        .map(
          (item) =>
            `• ${cleanText(item.title)} — ${formatAcademicDate(item.officialDeadline ?? item.officialDate)} (${item.id})`,
        ),
    );
  }
  return lines.join('\n');
}
