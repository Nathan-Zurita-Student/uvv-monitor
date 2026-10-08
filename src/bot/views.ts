import { upcoming, type Agenda, type AgendaEntry } from '../agenda/agenda.js';
import { isAiIrrelevant, publishedAt } from '../agenda/focus.js';
import { academicCategory, sourceOfItem } from '../assistant/catalog.js';
import { addDays, longDayLabel } from '../assistant/dates.js';
import { computeInsights } from '../assistant/insights.js';
import { classCancellations, classWeeklySlots } from '../assistant/classes.js';
import { weeklySlots } from '../assistant/memory.js';
import { buildTimeline, type TimelineEntry, type TimelineKind } from '../assistant/timeline.js';
import type { InfoSource } from '../assistant/types.js';
import type { AcademicItem } from '../models/academic-item.js';
import { normalizeDiscipline } from '../models/class-schedule.js';
import { fileIcon, type PortalDocument } from '../models/portal-document.js';
import { escapeHtml, italic, truncate } from '../telegram/html.js';
import { ACADEMIC_TIMEZONE, localDateKey, parseAcademicDate } from '../utils/dates.js';
import { dayMonth, itemIcon, itemLabel, shortDiscipline } from './activity.js';
import { encodeCallback, type ViewName } from './callbacks.js';
import {
  backToHome,
  plural,
  relativeDue,
  shortDate,
  viewButton,
  type Keyboard,
  type RenderContext,
  type Rendered,
} from './screens.js';
import { statusLabels } from './status.js';

function longToday(now: Date): string {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: ACADEMIC_TIMEZONE,
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  const weekday = part('weekday');
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${part('day')} de ${part('month')}`;
}

function listLine(entry: AgendaEntry, now: Date): string {
  const status = entry.item.status === 'TODO' ? '' : ` · ${statusLabels[entry.item.status]}`;
  const when = entry.date
    ? `${escapeHtml(shortDate(entry))} · ${relativeDue(entry, now)}`
    : 'sem data';
  return `${itemIcon(entry.kind)} <b>${escapeHtml(itemLabel(entry.item))}</b>\n${when}${status}`;
}

function itemButtons(entries: AgendaEntry[], from: ViewName, limit = 6): Keyboard {
  return entries.slice(0, limit).map((entry) => [
    {
      text: `${itemIcon(entry.kind)} ${truncate(itemLabel(entry.item), 32)}${entry.due ? ` · ${dayMonth(entry.due)}` : ''}`,
      callback_data: encodeCallback({
        type: 'item',
        itemId: entry.item.id,
        screen: { kind: 'detail', from },
      }),
    },
  ]);
}

function plainItemButtons(items: AcademicItem[], from: ViewName, limit = 6): Keyboard {
  return items.slice(0, limit).map((item) => [
    {
      text: `${categoryIcon(item)} ${truncate(itemLabel(item), 34)}`,
      callback_data: encodeCallback({
        type: 'item',
        itemId: item.id,
        screen: { kind: 'detail', from },
      }),
    },
  ]);
}

function moreLine(total: number, shown: number): string[] {
  return total > shown ? ['', italic(`+ ${plural(total - shown, 'item', 'itens')}`)] : [];
}

const count = (value: number) => (value ? ` (${String(value)})` : '');

const homeMenu = (agenda: Agenda): Keyboard => [
  [viewButton('📅 Hoje', 'today'), viewButton('📆 Semana', 'week')],
  [
    viewButton(`📝 Atividades${count(agenda.tasks.length)}`, 'tasks'),
    viewButton(`📚 Provas${count(agenda.exams.length)}`, 'exams'),
  ],
  [viewButton('⏰ Prazos', 'deadlines'), viewButton('✅ Concluídas', 'done')],
  [viewButton('📩 Novidades', 'news'), viewButton('🎓 UVV', 'uvv')],
  ...(agenda.overdue.length > 0 || agenda.undated.length > 0
    ? [
        [
          viewButton(`⚠️ Atrasadas${count(agenda.overdue.length)}`, 'late'),
          viewButton(`📌 Sem data${count(agenda.undated.length)}`, 'nodate'),
        ],
      ]
    : []),
  [viewButton('📂 Materiais', 'files'), viewButton('🤖 Perguntar', 'ask')],
  [
    viewButton('🔄 Atualizar', 'home', true),
    { text: '🔍 Verificar Portal agora', callback_data: encodeCallback({ type: 'sync' }) },
  ],
];

/** Arquivos já enviados no Telegram (os que podem ser reenviados pelo file_id). */
export function sendableMaterials(context: RenderContext): PortalDocument[] {
  return (context.materials ?? []).filter((document) => document.telegramFileId);
}

/** Chave curta e estável da disciplina para o botão (limite de 64 bytes do Telegram). */
export function disciplineKey(discipline: string): string {
  return normalizeDiscipline(discipline).slice(0, 30).trim();
}

function dayMonthOf(date: string): string {
  return date ? `${date.slice(8, 10)}/${date.slice(5, 7)}` : '';
}

function renderFiles(context: RenderContext): Rendered {
  const files = sendableMaterials(context);
  if (files.length === 0) {
    return {
      text: [
        '📂 <b>Materiais dos professores</b>',
        '',
        'Ainda não baixei arquivos dos posts. Eles chegam aqui depois da próxima verificação programada do Portal.',
      ].join('\n'),
      keyboard: [backToHome],
    };
  }
  const groups = new Map<string, PortalDocument[]>();
  for (const file of files) {
    const name = file.discipline.replace(/^\S+\s+-\s+/, '') || 'Outras';
    groups.set(name, [...(groups.get(name) ?? []), file]);
  }
  const ordered = [...groups.entries()].sort((left, right) => left[0].localeCompare(right[0]));
  const lines = ['📂 <b>Materiais dos professores</b>', ''];
  for (const [name, group] of ordered) {
    const last =
      group
        .map((file) => file.publishedOn)
        .sort()
        .at(-1) ?? '';
    lines.push(
      `📚 <b>${escapeHtml(shortDiscipline(name) ?? name)}</b> · ${plural(group.length, 'arquivo', 'arquivos')}${last ? ` · último em ${dayMonthOf(last)}` : ''}`,
    );
  }
  const recent = [...files]
    .sort((left, right) => right.publishedOn.localeCompare(left.publishedOn))
    .slice(0, 5);
  lines.push('', '<b>Mais recentes</b>');
  for (const file of recent) {
    lines.push(
      `${fileIcon(file.fileName)} ${escapeHtml(file.fileName)} · ${escapeHtml(shortDiscipline(file.discipline) ?? file.discipline)}${file.publishedOn ? ` · ${dayMonthOf(file.publishedOn)}` : ''}`,
    );
  }
  lines.push('', italic('Toque para eu mandar os arquivos aqui na conversa.'));
  const disciplineButtons = ordered.map(([name, group]) => ({
    text: `📚 ${truncate(shortDiscipline(name) ?? name, 24)} (${String(group.length)})`,
    callback_data: encodeCallback({ type: 'files', scope: 'discipline', key: disciplineKey(name) }),
  }));
  const rows: Keyboard = [];
  for (let index = 0; index < disciplineButtons.length; index += 2) {
    rows.push(disciplineButtons.slice(index, index + 2));
  }
  for (const file of recent) {
    rows.push([
      {
        text: `${fileIcon(file.fileName)} ${truncate(file.fileName, 40)}`,
        callback_data: encodeCallback({ type: 'files', scope: 'file', key: file.id }),
      },
    ]);
  }
  rows.push(backToHome);
  return { text: lines.join('\n'), keyboard: rows };
}

const sourceNames: Record<InfoSource, string> = {
  usuario: 'você',
  agenda: 'Agenda',
  portal: 'Portal',
  ava: 'AVA',
  email: 'e-mail',
  telegram: 'Telegram',
  memoria: 'memória',
  inferido: 'IA',
};

function categoryIcon(item: AcademicItem): string {
  const category = academicCategory(item);
  if (category === 'prova') return '📚';
  if (category === 'nota') return '🏅';
  if (['aviso', 'documento', 'pendencia', 'estagio', 'aula'].includes(category)) return '📣';
  return '📝';
}

const timelineIcons: Record<TimelineKind, string> = {
  prova: '📚',
  entrega: '📝',
  aula: '🏫',
  compromisso: '📌',
  estudo: '📖',
  lembrete: '⏰',
  dia_inteiro: '🗓️',
};

function timelineLine(entry: TimelineEntry): string {
  const icon = timelineIcons[entry.kind];
  const time =
    entry.kind === 'entrega' ? (entry.start ? ` · até ${entry.start}` : ' · entrega') : '';
  const prefix =
    entry.kind !== 'entrega' && entry.start
      ? `${entry.start}${entry.end ? `–${entry.end}` : ''} `
      : '';
  const status = entry.status === 'atrasada' ? ' · 🔴 atrasada' : '';
  const conditional = entry.conditional ? ' (só se precisar)' : '';
  if (entry.status === 'cancelada') {
    return `${icon} <s>${prefix}${escapeHtml(entry.title)}</s> · sem aula (aviso do professor)`;
  }
  const probable =
    !entry.start && entry.probableStart
      ? ` · provável ${entry.probableStart} (horário da aula)`
      : '';
  return `${icon} ${prefix}${escapeHtml(entry.title)}${conditional}${time}${probable}${status}`;
}

function timelineFor(context: RenderContext, from: string, to: string, withClasses: boolean) {
  const schedule = context.schedule;
  // O quadro de horários também dá o horário provável de provas sem hora, mesmo sem listar aulas.
  const slots = [
    ...classWeeklySlots(schedule?.classes ?? []),
    ...weeklySlots(schedule?.memory ?? []),
  ];
  return buildTimeline({
    from,
    to,
    now: context.now,
    agenda: context.agenda,
    ...(schedule?.events ? { events: schedule.events } : {}),
    ...(schedule?.personalReminders ? { reminders: schedule.personalReminders } : {}),
    ...(slots.length > 0
      ? {
          slots,
          listSlots: withClasses,
          cancellations: classCancellations(context.items, context.now),
        }
      : {}),
  });
}

function insightLines(context: RenderContext, limit: number): string[] {
  const insights = computeInsights({
    agenda: context.agenda,
    now: context.now,
    ...(context.schedule?.events ? { events: context.schedule.events } : {}),
  }).slice(0, limit);
  return insights.length > 0
    ? ['', ...insights.map((insight) => `💡 ${escapeHtml(insight.text)}`)]
    : [];
}

function calendarNote(context: RenderContext): string[] {
  if (context.schedule?.calendarError)
    return ['', italic('Não consegui ler sua Google Agenda agora; mostrei o resto.')];
  return [];
}

function academicButtons(
  context: RenderContext,
  timeline: TimelineEntry[],
  from: ViewName,
): Keyboard {
  const ids = new Set(
    timeline
      .filter((entry) => entry.kind === 'prova' || entry.kind === 'entrega')
      .map((entry) => entry.id),
  );
  const entries = [
    ...context.agenda.overdue,
    ...context.agenda.exams,
    ...context.agenda.tasks,
    ...context.agenda.conditionalExams,
  ].filter((entry) => ids.has(entry.item.id));
  return itemButtons(entries, from, 5);
}

function renderDays(
  context: RenderContext,
  from: string,
  to: string,
  view: 'week' | 'cal',
): Rendered {
  const timeline = timelineFor(context, from, to, view === 'week');
  const title =
    view === 'week'
      ? `📆 <b>Sua semana</b> · ${dayMonth(parseAcademicDate(from))} a ${dayMonth(parseAcademicDate(to))}`
      : '📅 <b>Próximos 14 dias</b>';
  const lines = [title];
  const byDay = new Map<string, TimelineEntry[]>();
  for (const entry of timeline) byDay.set(entry.date, [...(byDay.get(entry.date) ?? []), entry]);
  if (byDay.size === 0) lines.push('', 'Nada marcado nesse período. 🎉');
  for (const [day, entries] of byDay) {
    const label = longDayLabel(day);
    lines.push('', `<b>${escapeHtml(label.charAt(0).toUpperCase() + label.slice(1))}</b>`);
    lines.push(...entries.slice(0, 7).map(timelineLine));
    if (entries.length > 7) lines.push(italic(`+ ${plural(entries.length - 7, 'item', 'itens')}`));
  }
  if (view === 'week') {
    const free: string[] = [];
    for (let offset = 0; offset < 7; offset += 1) {
      const day = addDays(from, offset);
      if (!byDay.has(day)) free.push(longDayLabel(day).split(',')[0] ?? '');
    }
    if (free.length > 0 && byDay.size > 0) lines.push('', `🌿 Livre: ${free.join(', ')}`);
    lines.push(...insightLines(context, 2));
  }
  lines.push(...calendarNote(context));
  return {
    text: lines.join('\n'),
    keyboard: [
      ...academicButtons(context, timeline, view),
      view === 'week'
        ? [viewButton('📅 Hoje', 'today'), viewButton('⏰ Prazos', 'deadlines')]
        : [viewButton('📆 Semana', 'week')],
      backToHome,
    ],
  };
}

function renderToday(context: RenderContext): Rendered {
  const { now } = context;
  const today = localDateKey(now);
  const timeline = timelineFor(context, today, today, true);
  const lines = [`📅 <b>Hoje</b> · ${escapeHtml(longToday(now))}`, ''];
  if (timeline.length === 0) lines.push('Nada marcado pra hoje. ✨');
  lines.push(...timeline.map(timelineLine));
  const tomorrow = timelineFor(context, addDays(today, 1), addDays(today, 1), false).filter(
    (entry) => entry.kind === 'prova' || entry.kind === 'entrega',
  );
  if (tomorrow.length > 0) {
    lines.push('', `<b>Amanhã</b>`, ...tomorrow.slice(0, 4).map(timelineLine));
  }
  lines.push(...insightLines(context, 2), ...calendarNote(context));
  return {
    text: lines.join('\n').trim(),
    keyboard: [
      ...academicButtons(context, [...timeline, ...tomorrow], 'today'),
      [viewButton('📆 Semana', 'week'), viewButton('🤖 Perguntar', 'ask')],
      backToHome,
    ],
  };
}

function recentItems(context: RenderContext, days: number): AcademicItem[] {
  const since = context.now.getTime() - days * 86_400_000;
  return context.items
    .filter(
      (item) =>
        item.metadata?.contextOnly !== 'true' &&
        !isAiIrrelevant(item) &&
        !['DONE', 'IGNORED'].includes(item.status) &&
        publishedAt(item, context.now).getTime() >= since,
    )
    .sort(
      (left, right) =>
        publishedAt(right, context.now).getTime() - publishedAt(left, context.now).getTime(),
    );
}

function itemLine(item: AcademicItem, now: Date): string {
  const published = publishedAt(item, now);
  const status = ['DONE', 'IGNORED'].includes(item.status) ? ` · ${statusLabels[item.status]}` : '';
  return `${categoryIcon(item)} <b>${escapeHtml(itemLabel(item))}</b>\n${sourceNames[sourceOfItem(item)]} · ${dayMonth(published)}${status}`;
}

export function renderView(context: RenderContext, view: ViewName): Rendered {
  const { agenda, now } = context;
  if (view === 'home') {
    const next = upcoming(agenda, 60).slice(0, 5);
    const lines = ['🎓 <b>Sua faculdade</b>', escapeHtml(longToday(now)), ''];
    if (next.length > 0) {
      lines.push('🔥 <b>Próximos</b>');
      for (const entry of next) {
        lines.push(`${itemIcon(entry.kind)} ${escapeHtml(itemLabel(entry.item))}`);
        lines.push(`${entry.due ? dayMonth(entry.due) : ''} · ${relativeDue(entry, now)}`);
      }
    } else {
      lines.push('✨ Nenhuma prova ou entrega pela frente.');
    }
    if (agenda.overdue.length > 0) {
      lines.push(
        '',
        `⚠️ ${plural(agenda.overdue.length, 'atividade aparece', 'atividades aparecem')} como ${agenda.overdue.length === 1 ? 'atrasada' : 'atrasadas'}`,
      );
    }
    lines.push(...insightLines(context, 1));
    return { text: lines.join('\n'), keyboard: homeMenu(agenda) };
  }
  if (view === 'today') return renderToday(context);
  if (view === 'files') return renderFiles(context);
  if (view === 'week') {
    const today = localDateKey(now);
    return renderDays(context, today, addDays(today, 6), 'week');
  }
  if (view === 'cal') {
    const today = localDateKey(now);
    return renderDays(context, today, addDays(today, 13), 'cal');
  }
  if (view === 'ask') {
    return {
      text: [
        '🤖 <b>Pode falar comigo normalmente</b>',
        '',
        'É só mandar uma mensagem do jeito que você escreveria pra uma pessoa. Por exemplo:',
        '• como tá minha semana?',
        '• tenho prova essa semana?',
        '• o que eu deveria fazer hoje?',
        '• algum professor mandou algo importante?',
        '• organiza meus estudos pra prova de cálculo',
        '• me lembra da AOP amanhã às 19h',
        '',
        'Também guardo sua rotina: “minha aula de Cálculo é segunda e quarta às 19h”.',
      ].join('\n'),
      keyboard: [backToHome],
    };
  }
  if (view === 'exams') {
    const lines = ['📚 <b>Provas</b>', ''];
    if (agenda.exams.length === 0) lines.push('Nenhuma prova marcada por enquanto. 🎉');
    lines.push(...agenda.exams.slice(0, 8).flatMap((entry) => [listLine(entry, now), '']));
    lines.push(...moreLine(agenda.exams.length, 8));
    if (agenda.conditionalExams.length > 0) {
      lines.push(`🔁 <b>2ª chamada e finais</b> ${italic('(só se precisar)')}`);
      lines.push(
        ...agenda.conditionalExams
          .slice(0, 6)
          .map(
            (entry) =>
              `${entry.due ? dayMonth(entry.due) : ''} · ${escapeHtml(itemLabel(entry.item))}`,
          ),
      );
    }
    return {
      text: lines.join('\n').trim(),
      keyboard: [...itemButtons(agenda.exams, 'exams'), backToHome],
    };
  }
  if (view === 'deadlines') {
    const entries = [
      ...agenda.overdue.filter((entry) => (entry.days ?? 0) >= -7),
      ...upcoming(agenda, 21),
    ];
    const lines = ['⏰ <b>Próximos prazos</b>', ''];
    if (entries.length === 0) lines.push('Nenhum prazo nas próximas três semanas. 🎉');
    lines.push(...entries.slice(0, 10).flatMap((entry) => [listLine(entry, now), '']));
    lines.push(...moreLine(entries.length, 10));
    return {
      text: lines.join('\n').trim(),
      keyboard: [...itemButtons(entries, 'deadlines'), backToHome],
    };
  }
  if (view === 'done') {
    const done = context.items
      .filter((item) => item.status === 'DONE' && item.metadata?.contextOnly !== 'true')
      .sort((left, right) => publishedAt(right, now).getTime() - publishedAt(left, now).getTime());
    const lines = ['✅ <b>Concluídas</b>', ''];
    if (done.length === 0) lines.push('Nada marcado como concluído ainda.');
    lines.push(...done.slice(0, 8).flatMap((item) => [itemLine(item, now), '']));
    lines.push(...moreLine(done.length, 8));
    if (done.length > 0) lines.push(italic('Toque numa atividade para reabrir.'));
    return {
      text: lines.join('\n').trim(),
      keyboard: [...plainItemButtons(done, 'done'), backToHome],
    };
  }
  if (view === 'news') {
    const recent = recentItems(context, 7);
    const lines = ['📩 <b>Novidades dos últimos 7 dias</b>', ''];
    if (recent.length === 0)
      lines.push('Nada novo no Portal, no AVA ou nos e-mails da faculdade. 😌');
    lines.push(...recent.slice(0, 8).flatMap((item) => [itemLine(item, now), '']));
    lines.push(...moreLine(recent.length, 8));
    return {
      text: lines.join('\n').trim(),
      keyboard: [...plainItemButtons(recent, 'news'), backToHome],
    };
  }
  if (view === 'uvv') {
    const notices = recentItems(context, 30).filter((item) =>
      ['aviso', 'documento', 'pendencia', 'estagio', 'nota', 'aula'].includes(
        academicCategory(item),
      ),
    );
    const lines = ['🎓 <b>UVV: avisos, documentos e notas</b>', ''];
    if (notices.length === 0) lines.push('Nenhum aviso da faculdade nos últimos 30 dias.');
    lines.push(...notices.slice(0, 8).flatMap((item) => [itemLine(item, now), '']));
    lines.push(...moreLine(notices.length, 8));
    return {
      text: lines.join('\n').trim(),
      keyboard: [...plainItemButtons(notices, 'uvv'), backToHome],
    };
  }
  if (view === 'tasks' || view === 'late' || view === 'nodate') {
    const config = {
      tasks: {
        title: '📝 <b>Atividades</b>',
        entries: agenda.tasks,
        empty: 'Nenhuma entrega com prazo pela frente. 🎉',
      },
      late: { title: '⚠️ <b>Atrasadas</b>', entries: agenda.overdue, empty: 'Nada atrasado. 👏' },
      nodate: {
        title: '📌 <b>Sem data definida</b>',
        entries: agenda.undated,
        empty: 'Tudo tem data definida.',
      },
    }[view];
    const lines = [config.title, ''];
    if (config.entries.length === 0) lines.push(config.empty);
    lines.push(...config.entries.slice(0, 8).flatMap((entry) => [listLine(entry, now), '']));
    lines.push(...moreLine(config.entries.length, 8));
    if (view === 'late' && config.entries.length > 0) {
      lines.push(italic('Se já entregou, toque na atividade e marque como concluída.'));
    }
    return {
      text: lines.join('\n').trim(),
      keyboard: [...itemButtons(config.entries, view), backToHome],
    };
  }
  // Amanhã (enviado às 21h): o que ainda vence hoje e o que vem amanhã.
  const todayTasks = upcoming(agenda, 0).filter((entry) => entry.kind === 'TASK');
  const tomorrow = upcoming(agenda, 1).filter((entry) => entry.days === 1);
  const tomorrowDate = new Date(now.getTime() + 24 * 60 * 60_000);
  const lines = [`🌙 <b>Amanhã</b> · ${escapeHtml(longToday(tomorrowDate))}`, ''];
  if (todayTasks.length > 0) {
    lines.push('⏰ <b>Ainda hoje</b>', ...todayTasks.map((entry) => listLine(entry, now)), '');
  }
  if (tomorrow.length > 0) {
    lines.push(...tomorrow.flatMap((entry) => [listLine(entry, now), '']));
  } else if (todayTasks.length === 0) {
    lines.push('Nada pra amanhã. 🎉');
  }
  return {
    text: lines.join('\n').trim(),
    keyboard: [
      ...itemButtons([...todayTasks, ...tomorrow], 'tomorrow'),
      [viewButton('📋 Painel', 'home')],
    ],
  };
}
