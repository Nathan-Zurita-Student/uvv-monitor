import { upcoming, type AgendaEntry } from '../agenda/agenda.js';
import { itemLabel, shortDiscipline } from './activity.js';
import { encodeCallback } from './callbacks.js';
import { statusLabels } from './status.js';
import { escapeHtml, link, truncate } from '../telegram/html.js';
import { formatShortDate, localDateAt, localDateKey } from '../utils/dates.js';
import { isWeeklyReviewRun, type DailySlot } from '../scheduler/windows.js';
import type { RenderContext, Rendered } from './screens.js';

export const digestSlots = ['12:00', '17:00', '20:00'] as const;
export type DigestSlot = (typeof digestSlots)[number];

/** Janela de recuperação: até uma hora depois, nunca antes do horário. */
export function dueDigestSlot(
  now: Date,
  alreadySent: (key: string) => boolean,
): DigestSlot | undefined {
  return digestSlots.find((slot) => {
    const hour = Number(slot.slice(0, 2));
    const elapsed = now.getTime() - localDateAt(now, hour).getTime();
    return elapsed >= 0 && elapsed < 60 * 60_000 && !alreadySent(`${localDateKey(now)} ${slot}`);
  });
}

export interface DigestSourceState {
  portal: string;
  gmail: string;
  calendar: string;
}

function entryLine(entry: AgendaEntry): string {
  const item = entry.item;
  const discipline = shortDiscipline(item.discipline);
  const date = entry.date
    ? formatShortDate(entry.date.value, entry.kind === 'TASK')
    : 'data não confirmada';
  const location = item.metadata?.location;
  const sourceLink = link(item.sourceUrl, 'Abrir fonte');
  const url =
    /^https:\/\//i.test(item.sourceUrl) && item.sourceUrl.length <= 250 && sourceLink.length < 600
      ? `\n🔗 ${sourceLink}`
      : '';
  return (
    [
      `<b>${escapeHtml(truncate(itemLabel(item), 120))}</b>`,
      ...(discipline ? [`🎓 ${escapeHtml(truncate(discipline, 80))}`] : []),
      `📅 ${escapeHtml(date)}${entry.date?.source === 'AI' ? ' · precisa de confirmação' : ''}${entry.days !== undefined && entry.days < 0 ? ' · atrasada' : ''}`,
      `📊 ${escapeHtml(statusLabels[item.status])}`,
      ...(location ? [`📍 ${escapeHtml(truncate(location, 180))}`] : []),
    ].join('\n') + url
  );
}

/** Não usa IA nem depende de uma coleta bem-sucedida naquele horário. */
export function renderDailyDigest(
  context: RenderContext,
  slot: DailySlot,
  sources?: DigestSourceState,
): Rendered {
  const weekly = isWeeklyReviewRun(context.now, slot);
  const horizon = weekly ? 7 : slot === '20:00' || slot === '21:00' ? 3 : 1;
  const relevant = [...context.agenda.overdue, ...upcoming(context.agenda, horizon)];
  const unique = [...new Map(relevant.map((entry) => [entry.item.id, entry])).values()];
  const shown: AgendaEntry[] = [];
  let used = 0;
  for (const entry of unique.slice(0, 3)) {
    used += entryLine(entry).length + 2;
    if (used > 2800) break;
    shown.push(entry);
  }
  const last = Date.parse(context.lastSyncAt ?? '');
  const age = context.now.getTime() - last;
  const hasTimestamp = Number.isFinite(last) && age >= -60_000;
  const stale = !hasTimestamp || age > 90 * 60_000;
  const lines = [
    `🎓 <b>Seu resumo UVV · ${slot}</b>`,
    weekly
      ? 'Revisão dos próximos 7 dias'
      : horizon === 3
        ? 'Prioridades e próximos 3 dias'
        : 'O que merece sua atenção hoje e amanhã',
    '',
    ...(shown.length > 0
      ? shown.map(entryLine).flatMap((line) => [line, ''])
      : ['Nenhuma prova ou entrega pendente encontrada para esse período na memória salva.', '']),
    ...(unique.length > shown.length
      ? [`Mais ${String(unique.length - shown.length)} compromisso(s) no painel.`, '']
      : []),
    ...(context.agenda.undated.length > 0 || context.agenda.otherPending.length > 0
      ? [
          `⚠️ Há ${String(context.agenda.undated.length + context.agenda.otherPending.length)} pendência(s) sem data ou que precisa(m) de confirmação. Veja o painel.`,
          '',
        ]
      : []),
    hasTimestamp
      ? `🕒 Última coleta finalizada: ${escapeHtml(formatShortDate(context.lastSyncAt!))}.`
      : '⚠️ Ainda não há registro de uma coleta finalizada.',
    ...(stale
      ? [
          '⚠️ A coleta deste horário ainda não está confirmada. Este resumo usa dados anteriores; podem existir novidades que ainda não consegui verificar.',
        ]
      : []),
  ];
  if (sources) {
    const failed = Object.entries(sources).filter(([, status]) => status !== 'SUCCESS');
    const names: Record<string, string> = {
      portal: 'Portal/AVA',
      gmail: 'Gmail',
      calendar: 'Calendar',
    };
    if (failed.length > 0)
      lines.push(
        `⚠️ Na última coleta: ${failed.map(([name, status]) => `${names[name]} ${status === 'PARTIAL' ? 'verificado parcialmente' : 'não verificado'}`).join('; ')}.`,
      );
  } else {
    lines.push('⚠️ Não tenho o resultado de verificação de cada fonte nesta cópia.');
  }
  return {
    text: lines.join('\n'),
    keyboard: [
      ...shown.map((entry) => [
        {
          text: truncate(`📌 ${itemLabel(entry.item)}`, 48),
          callback_data: encodeCallback({
            type: 'item',
            itemId: entry.item.id,
            screen: { kind: 'detail', from: 'home' },
          }),
        },
      ]),
      [
        {
          text: '📋 Ver todas as pendências',
          callback_data: encodeCallback({ type: 'view', view: 'home', refresh: true }),
        },
      ],
      [
        {
          text: '📂 Materiais de estudo',
          callback_data: encodeCallback({ type: 'view', view: 'files', refresh: false }),
        },
      ],
    ],
  };
}
