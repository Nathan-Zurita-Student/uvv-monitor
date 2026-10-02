import { upcoming, type Agenda, type AgendaEntry } from '../agenda/agenda.js';
import { displayTitle, effectiveDate } from '../agenda/focus.js';
import { studyTopics, type FocusSuggestion } from '../ai/planner.js';
import type { AcademicItem, ItemStatus } from '../models/academic-item.js';
import type { ItemChange } from '../persistence/deduplication.js';
import {
  formatLongDay,
  formatShortDate,
  localDateKey,
  parseAcademicDate,
  relativeDayLabel,
} from '../utils/dates.js';
import { bold, code, escapeHtml, italic, link, packBlocks, truncate } from './html.js';

/** Substituído pelo rótulo do andamento ao enviar e ao editar a mensagem (inclusive no Apps Script). */
export const STATUS_PLACEHOLDER = '{{STATUS}}';

export const taskStatusLabels: Record<ItemStatus, string> = {
  TODO: '⏳ Não iniciado',
  IN_PROGRESS: '🔄 Em andamento',
  DONE: '✅ Concluído',
  WAITING: '⏸️ Aguardando',
  NEEDS_CONFIRMATION: '⚠️ Precisa confirmar',
  IGNORED: '🙈 Ignorado',
};

const shortStatusLabels: Partial<Record<ItemStatus, string>> = {
  TODO: '⏳ não iniciado',
  IN_PROGRESS: '🔄 em andamento',
  WAITING: '⏸️ aguardando',
  NEEDS_CONFIRMATION: '⚠️ confirmar',
};

export function renderStatus(template: string, status: ItemStatus): string {
  return template.replace(STATUS_PLACEHOLDER, taskStatusLabels[status]);
}

function urgencyDot(days: number | undefined): string {
  if (days === undefined) return '⚪';
  if (days <= 1) return '🔴';
  if (days <= 3) return '🟠';
  if (days <= 7) return '🟡';
  return '🟢';
}

function relative(days: number): string {
  const label = relativeDayLabel(days);
  return days <= 3 ? `<b>${label}</b>` : label;
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

function titleLink(item: AcademicItem, maxLength = 70): string {
  return link(item.sourceUrl, truncate(displayTitle(item), maxLength));
}

function dateLine(entry: AgendaEntry, showStatus: boolean): string {
  if (!entry.date || entry.days === undefined) return '📅 Data ainda não informada';
  const parts = [
    `📅 ${formatShortDate(entry.date.value, entry.date.deadline)}`,
    relative(entry.days),
  ];
  if (entry.date.source === 'AI') parts.push(italic('data lida do texto'));
  const status = shortStatusLabels[entry.item.status];
  if (showStatus && status) parts.push(status);
  return parts.join(' · ');
}

function topicsLine(entry: AgendaEntry, maxLength = 150): string | undefined {
  const topics = studyTopics(entry);
  return topics.length > 0 ? `📖 ${escapeHtml(truncate(topics.join('; '), maxLength))}` : undefined;
}

function entryBlock(entry: AgendaEntry): string {
  const lines = [`${urgencyDot(entry.days)} <b>${titleLink(entry.item)}</b>`];
  if (entry.item.discipline) lines.push(italic(truncate(entry.item.discipline, 60)));
  lines.push(dateLine(entry, entry.kind === 'TASK'));
  if (entry.kind === 'EXAM' && (entry.days ?? 99) <= 14) {
    const topics = topicsLine(entry);
    if (topics) lines.push(topics);
  }
  return lines.join('\n');
}

function compactLine(entry: AgendaEntry): string {
  const discipline = entry.item.discipline
    ? ` · ${escapeHtml(truncate(entry.item.discipline, 40))}`
    : '';
  return `<b>${titleLink(entry.item, 50)}</b>${discipline}`;
}

function sectionBlocks(header: string, entries: AgendaEntry[], limit: number): string[] {
  const visible = entries.slice(0, limit).map(entryBlock);
  const hidden = entries.length - visible.length;
  if (hidden > 0) visible.push(italic(`+ ${String(hidden)} mais adiante`));
  const [first, ...rest] = visible;
  return [`${header}\n\n${first ?? ''}`.trimEnd(), ...rest];
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${String(count)} ${count === 1 ? singular : pluralForm}`;
}

export function formatPanel(agenda: Agenda): string[] {
  const time = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  }).format(agenda.now);
  const header = `📚 <b>PAINEL ACADÊMICO</b>\n${italic(`${formatLongDay(agenda.now)} · atualizado às ${time}`)}`;
  const counts = [
    `📝 ${plural(agenda.exams.length, 'prova', 'provas')}`,
    `✍️ ${plural(agenda.tasks.length, 'entrega', 'entregas')}`,
    ...(agenda.overdue.length > 0
      ? [`⚠️ ${plural(agenda.overdue.length, 'atrasada', 'atrasadas')}`]
      : []),
  ].join('  ·  ');
  const blocks: string[] = [counts];

  blocks.push(
    ...(agenda.exams.length > 0
      ? sectionBlocks('📝 <b>PROVAS</b>', agenda.exams, 8)
      : ['📝 <b>PROVAS</b>\nNenhuma prova marcada por enquanto. 🎉']),
  );
  blocks.push(
    ...(agenda.tasks.length > 0
      ? sectionBlocks('✍️ <b>TRABALHOS E TAREFAS</b>', agenda.tasks, 10)
      : ['✍️ <b>TRABALHOS E TAREFAS</b>\nNenhuma entrega com prazo pela frente. 🎉']),
  );
  if (agenda.overdue.length > 0) {
    blocks.push(
      [
        '⚠️ <b>ATRASADAS</b>',
        ...agenda.overdue.slice(0, 6).map((entry) => {
          const when = entry.date ? formatShortDate(entry.date.value, entry.date.deadline) : '';
          return `🔴 ${compactLine(entry)}\n     venceu ${when} (${relativeDayLabel(entry.days ?? 0)})`;
        }),
        ...(agenda.overdue.length > 6
          ? [italic(`+ ${plural(agenda.overdue.length - 6, 'atrasada', 'atrasadas')}`)]
          : []),
      ].join('\n'),
    );
  }
  if (agenda.undated.length > 0) {
    blocks.push(
      [
        '📌 <b>SEM DATA DEFINIDA</b>',
        ...agenda.undated
          .slice(0, 5)
          .map((entry) => `${entry.kind === 'EXAM' ? '📝' : '✍️'} ${compactLine(entry)}`),
        ...(agenda.undated.length > 5
          ? [italic(`+ ${plural(agenda.undated.length - 5, 'item', 'itens')}`)]
          : []),
      ].join('\n'),
    );
  }
  if (agenda.otherPending.length > 0) {
    blocks.push(
      [
        '📎 <b>OUTRAS PENDÊNCIAS</b>',
        ...agenda.otherPending.slice(0, 3).map((item) => `• <b>${titleLink(item, 60)}</b>`),
      ].join('\n'),
    );
  }
  if (agenda.conditionalExams.length > 0) {
    blocks.push(
      [
        `🔁 <b>2ª CHAMADA E FINAIS</b> ${italic('(só se precisar)')}`,
        ...agenda.conditionalExams.slice(0, 6).map((entry) => {
          const day = entry.date ? formatShortDate(entry.date.value) : '';
          const discipline = entry.item.discipline
            ? ` · ${escapeHtml(truncate(entry.item.discipline, 40))}`
            : '';
          return `• ${day} — ${titleLink(entry.item, 40)}${discipline}`;
        }),
        ...(agenda.conditionalExams.length > 6
          ? [italic(`+ ${plural(agenda.conditionalExams.length - 6, 'data', 'datas')}`)]
          : []),
      ].join('\n'),
    );
  }
  return packBlocks(header, blocks, '📚 <b>PAINEL ACADÊMICO</b> · continuação');
}

export type CardKind = 'NEW' | 'DATE_SET' | 'DATE_CHANGED' | 'UPDATED' | 'CHECKIN';

function cardHeadline(entry: AgendaEntry, kind: CardKind): string {
  const exam = entry.kind === 'EXAM';
  if (kind === 'NEW') return exam ? '🆕 <b>NOVA PROVA</b>' : '🆕 <b>NOVA ENTREGA</b>';
  if (kind === 'DATE_SET') return '📅 <b>PRAZO DEFINIDO</b>';
  if (kind === 'DATE_CHANGED') return '📅 <b>DATA ALTERADA</b>';
  if (kind === 'UPDATED')
    return exam ? '✏️ <b>PROVA ATUALIZADA</b>' : '✏️ <b>ENTREGA ATUALIZADA</b>';
  if ((entry.days ?? 0) < 0) return '⚠️ <b>ENTREGA ATRASADA</b>';
  return exam ? '📚 <b>COMO ESTÁ A PREPARAÇÃO?</b>' : '📋 <b>COMO ESTÁ ESSA ENTREGA?</b>';
}

function listSection(title: string, values: string[], limit: number): string[] {
  if (values.length === 0) return [];
  return [
    '',
    title,
    ...values.slice(0, limit).map((value) => `• ${escapeHtml(truncate(value, 220))}`),
  ];
}

/**
 * Cartão de prova/entrega com o andamento como {{STATUS}}. O mesmo modelo é guardado na
 * planilha para que os botões possam reeditar a mensagem sem perder a formatação.
 */
export function formatItemCard(
  entry: AgendaEntry,
  kind: CardKind,
  changes: ItemChange[] = [],
): string {
  const full = buildCard(entry, kind, changes, kind === 'CHECKIN');
  return full.length <= 3_800 ? full : buildCard(entry, kind, changes, true);
}

function buildCard(
  entry: AgendaEntry,
  kind: CardKind,
  changes: ItemChange[],
  compact: boolean,
): string {
  const { item } = entry;
  const metadata = item.metadata ?? {};
  const lines = [cardHeadline(entry, kind), '', `<b>${titleLink(item, 90)}</b>`];
  if (item.discipline) lines.push(`🎓 ${escapeHtml(item.discipline)}`);
  lines.push(dateLine(entry, false));
  const previousDate = changes.find(
    (change) => change.field === 'officialDeadline' || change.field === 'officialDate',
  )?.before;
  if (kind === 'DATE_CHANGED' && previousDate) {
    lines.push(`↩️ Antes: <s>${escapeHtml(formatShortDate(previousDate))}</s>`);
  }
  if (entry.date?.source === 'AI' && metadata.aiDueEvidence) {
    lines.push(italic(`Trecho: “${truncate(metadata.aiDueEvidence, 140)}”`));
  }
  const summary = metadata.aiSummary;
  if (summary && !compact) lines.push('', `🧠 ${escapeHtml(truncate(summary, 600))}`);
  else if (
    !summary &&
    !compact &&
    kind === 'NEW' &&
    item.description.trim() !== item.title.trim()
  ) {
    lines.push('', escapeHtml(truncate(item.description, 400)));
  }
  lines.push(
    ...listSection('✅ <b>O que fazer</b>', parseList(metadata.aiActions), compact ? 2 : 5),
  );
  if (entry.kind === 'EXAM') {
    lines.push(...listSection('📖 <b>O que estudar</b>', studyTopics(entry), compact ? 5 : 8));
  }
  if (!compact) {
    lines.push(...listSection('📚 <b>Materiais</b>', parseList(metadata.aiMaterials), 5));
    lines.push(
      ...listSection('❓ <b>Ainda não informado</b>', parseList(metadata.aiOpenQuestions), 4),
    );
    if (summary && metadata.aiCertainty !== 'CONFIRMED') {
      lines.push('', italic('Resumo automático — confira os detalhes na fonte.'));
    }
  }
  lines.push('', `📊 <b>Andamento:</b> ${STATUS_PLACEHOLDER}`, code(item.id));
  return lines.join('\n');
}

export function formatOtherNews(items: AcademicItem[]): string[] {
  if (items.length === 0) return [];
  const blocks = items.slice(0, 8).map((item) => {
    const discipline = item.discipline ? ` · ${italic(truncate(item.discipline, 50))}` : '';
    const summary = item.metadata?.aiSummary ?? item.description;
    return `• <b>${titleLink(item, 80)}</b>${discipline}\n${escapeHtml(truncate(summary, 180))}`;
  });
  if (items.length > 8) blocks.push(italic(`+ ${plural(items.length - 8, 'aviso', 'avisos')}`));
  return packBlocks(
    `📬 <b>OUTROS AVISOS</b> ${italic(`(${String(items.length)})`)}`,
    blocks,
    '📬 <b>OUTROS AVISOS</b> · continuação',
  );
}

function dayLine(entry: AgendaEntry): string {
  const icon = entry.kind === 'EXAM' ? '📝' : '✍️';
  const discipline = entry.item.discipline
    ? ` · ${escapeHtml(truncate(entry.item.discipline, 40))}`
    : '';
  return `${icon} <b>${titleLink(entry.item, 50)}</b>${discipline}`;
}

function timeSuffix(entry: AgendaEntry): string {
  if (!entry.date || !/T\d{2}:\d{2}/.test(entry.date.value)) return '';
  return ` · até ${formatShortDate(entry.date.value).split(' · ')[1] ?? ''}`;
}

export function formatDueToday(agenda: Agenda): string {
  const today = upcoming(agenda, 0).filter((entry) => entry.item.status !== 'DONE');
  if (today.length === 0) return '';
  return [
    '⏰ <b>AINDA HOJE</b>',
    '',
    ...today.map((entry) => `${dayLine(entry)}${entry.kind === 'TASK' ? timeSuffix(entry) : ''}`),
  ].join('\n');
}

export function formatTomorrow(agenda: Agenda, focus: FocusSuggestion[]): string {
  const tomorrow = new Date(agenda.now.getTime() + 24 * 60 * 60_000);
  const lines = [`🌙 <b>AMANHÃ</b> · ${escapeHtml(formatLongDay(tomorrow))}`];
  const dueToday = upcoming(agenda, 0).filter((entry) => entry.kind === 'TASK');
  const next = upcoming(agenda, 1).filter((entry) => entry.days === 1);
  const exams = next.filter((entry) => entry.kind === 'EXAM');
  const tasks = next.filter((entry) => entry.kind === 'TASK');
  if (dueToday.length > 0) {
    lines.push(
      '',
      '⏰ <b>Ainda hoje</b>',
      ...dueToday.map((entry) => `${dayLine(entry)}${timeSuffix(entry)}`),
    );
  }
  if (exams.length > 0) {
    lines.push('', '📝 <b>Prova amanhã</b>');
    for (const entry of exams) {
      lines.push(dayLine(entry));
      const topics = topicsLine(entry, 200);
      if (topics) lines.push(topics);
    }
  }
  if (tasks.length > 0) {
    lines.push(
      '',
      '✍️ <b>Entrega amanhã</b>',
      ...tasks.map((entry) => `${dayLine(entry)}${timeSuffix(entry)}`),
    );
  }
  const byId = new Map(
    [...agenda.exams, ...agenda.tasks, ...agenda.overdue].map((entry) => [entry.item.id, entry]),
  );
  const focusLines = focus.flatMap((suggestion, index) => {
    const entry = byId.get(suggestion.itemId);
    if (!entry) return [];
    return [
      `${String(index + 1)}. <b>${titleLink(entry.item, 45)}</b>${entry.item.discipline ? ` · ${escapeHtml(truncate(entry.item.discipline, 30))}` : ''}\n    ${escapeHtml(truncate(suggestion.action, 160))}`,
    ];
  });
  if (focusLines.length > 0) lines.push('', '🎯 <b>Foco sugerido</b>', ...focusLines);
  const later = upcoming(agenda, 7).filter((entry) => (entry.days ?? 0) >= 2);
  if (later.length > 0) {
    lines.push(
      '',
      '🗓️ <b>Próximos dias</b>',
      ...later.slice(0, 8).map((entry) => {
        const day = entry.date ? formatShortDate(entry.date.value) : '';
        return `• ${escapeHtml(day)} — ${dayLine(entry)}`;
      }),
    );
  }
  if (dueToday.length + next.length + later.length === 0) {
    lines.push('', '✨ Nenhuma prova ou entrega nos próximos 7 dias.');
  }
  return lines.join('\n');
}

export function formatWeek(agenda: Agenda): string {
  const week = upcoming(agenda, 7).filter((entry) => (entry.days ?? 0) >= 1);
  const start = new Date(agenda.now.getTime() + 24 * 60 * 60_000);
  const end = new Date(agenda.now.getTime() + 7 * 24 * 60 * 60_000);
  const lines = [
    `🗓️ <b>SUA SEMANA</b> · ${escapeHtml(formatShortDate(localDateKey(start)))} a ${escapeHtml(formatShortDate(localDateKey(end)))}`,
  ];
  if (week.length === 0) {
    lines.push('', '✨ Nenhuma prova ou entrega marcada para os próximos 7 dias.');
  }
  const byDay = new Map<string, AgendaEntry[]>();
  for (const entry of week) {
    const key = entry.due ? localDateKey(entry.due) : '';
    byDay.set(key, [...(byDay.get(key) ?? []), entry]);
  }
  for (const [day, entries] of byDay) {
    lines.push('', bold(formatShortDate(day)), ...entries.map(dayLine));
  }
  const month = upcoming(agenda, 30).filter((entry) => (entry.days ?? 0) > 7);
  if (month.length > 0) {
    const exams = month.filter((entry) => entry.kind === 'EXAM').length;
    const tasks = month.length - exams;
    lines.push(
      '',
      italic(
        `Depois disso, nos próximos 30 dias: ${plural(exams, 'prova', 'provas')} e ${plural(tasks, 'entrega', 'entregas')}.`,
      ),
    );
  }
  return lines.join('\n');
}

export function formatBootstrap(candidates: number): string {
  return [
    '✅ <b>Tudo pronto!</b>',
    '',
    `Fiz a primeira leitura do Portal, Gmail e Calendar e encontrei ${String(candidates)} registros acadêmicos.`,
    'Guardei os comunicados antigos no histórico sem tratá-los como novidades. A partir de agora você recebe só o que importa: provas, entregas e avisos novos.',
  ].join('\n');
}

/** Data efetiva formatada para textos simples (comandos de status). */
export function describeDate(item: AcademicItem): string {
  const date = effectiveDate(item);
  if (!date) return 'Data ainda não informada';
  return formatShortDate(date.value, date.deadline);
}

export function isValidDate(value: string): boolean {
  return !Number.isNaN(parseAcademicDate(value).getTime());
}
