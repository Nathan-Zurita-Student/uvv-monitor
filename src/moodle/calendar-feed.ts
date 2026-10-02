import type { ItemStatus, ItemType } from '../models/academic-item.js';
import type { DetectedItemCandidate } from '../persistence/deduplication.js';
import { inferItemType } from '../portal/parsers.js';
import { extractPoints } from './activity-parser.js';

const DEFAULT_MOODLE_CALENDAR_URL = 'https://saladeaula.ead.uvv.br/calendar/view.php';

interface IcsEvent {
  uid: string;
  summary: string;
  description: string;
  url?: string;
  categories?: string;
  startsAt: string;
}

function decodeIcsText(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

function parseIcsDate(value: string): string | undefined {
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value);
  if (!match) return undefined;
  const local = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`;
  return match[7] ? `${local}Z` : local;
}

function parseEvent(block: string): IcsEvent | undefined {
  const properties = new Map<string, string>();
  for (const line of block.split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const name = line.slice(0, separator).split(';')[0]?.toUpperCase();
    if (name && !properties.has(name)) properties.set(name, line.slice(separator + 1));
  }
  const uid = properties.get('UID')?.trim();
  const summary = properties.get('SUMMARY');
  const startsAt = parseIcsDate(properties.get('DTSTART') ?? '');
  if (!uid || !summary || !startsAt) return undefined;
  const url = properties.get('URL')?.trim();
  return {
    uid,
    summary: decodeIcsText(summary),
    description: decodeIcsText(properties.get('DESCRIPTION') ?? summary),
    startsAt,
    ...(url ? { url } : {}),
    ...(properties.get('CATEGORIES')
      ? { categories: decodeIcsText(properties.get('CATEGORIES') ?? '') }
      : {}),
  };
}

function statusFor(type: ItemType): ItemStatus {
  return ['EXAM', 'ASSIGNMENT', 'AOP', 'DOCUMENT'].includes(type) ? 'TODO' : 'WAITING';
}

function disciplineFor(event: IcsEvent): string | undefined {
  const descriptionCourse = /(?:curso|course)\s*:\s*([^\r\n|;]+)/i
    .exec(event.description)?.[1]
    ?.trim();
  const value = descriptionCourse || event.categories;
  return value && !/^(evento|event|curso|course)$/i.test(value) ? value : undefined;
}

const phasePrefix = /^(in[ií]cio|abertura|t[eé]rmino|encerramento|fechamento)\s+d[eoa]s?\s+/i;

/** "Início de X" só marca quando a atividade abre; não é prazo. */
function isOpeningEvent(summary: string): boolean {
  return /^(in[ií]cio|abertura)\b/i.test(summary.trim());
}

function activityKey(title: string): string {
  return title
    .trim()
    .replace(phasePrefix, '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function sameMinute(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  const leftTime = Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(left) ? left : `${left}-03:00`);
  const rightTime = Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(right) ? right : `${right}-03:00`);
  return Math.abs(leftTime - rightTime) < 60_000;
}

function toIso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const instant = Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}-03:00`);
  return Number.isNaN(instant) ? undefined : new Date(instant).toISOString();
}

/**
 * O calendário EAD repete as atividades do AVA ("Início de X" e "Término de X") e usa o código
 * do curso como disciplina. Une esses eventos à atividade (que ganha data de abertura e
 * pontuação), marca-os como contexto e troca o código pelo nome da disciplina.
 */
export function reconcileEadCalendar(candidates: DetectedItemCandidate[]): DetectedItemCandidate[] {
  const activities = candidates.filter(
    (candidate) => candidate.metadata?.origin === 'EAD' && /\/mod\//.test(candidate.sourceUrl),
  );
  const events = candidates.filter((candidate) => candidate.metadata?.origin === 'EAD_CALENDAR');
  const disciplineByCode = new Map<string, string>();
  const matches = new Map<DetectedItemCandidate, DetectedItemCandidate>();
  const sameTitle = (event: DetectedItemCandidate) =>
    activities.filter((activity) => activityKey(activity.title) === activityKey(event.title));

  // Prazos primeiro: o mesmo horário de encerramento identifica a atividade e a disciplina.
  for (const event of events.filter((candidate) => !isOpeningEvent(candidate.title))) {
    const options = sameTitle(event);
    const eventDate = event.officialDeadline ?? event.officialDate;
    const exact = options.filter((activity) => sameMinute(activity.officialDeadline, eventDate));
    const match = exact.length === 1 ? exact[0] : options.length === 1 ? options[0] : undefined;
    if (!match) continue;
    matches.set(event, match);
    if (event.discipline && match.discipline) {
      disciplineByCode.set(event.discipline, match.discipline);
    }
  }
  // Aberturas: usa a disciplina aprendida acima para escolher entre atividades homônimas.
  for (const event of events.filter((candidate) => isOpeningEvent(candidate.title))) {
    const discipline = event.discipline ? disciplineByCode.get(event.discipline) : undefined;
    const options = sameTitle(event).filter(
      (activity) => !discipline || activity.discipline === discipline,
    );
    if (options.length === 1 && options[0]) matches.set(event, options[0]);
  }

  const enrichment = new Map<DetectedItemCandidate, Record<string, string>>();
  for (const [event, activity] of matches) {
    const extra = enrichment.get(activity) ?? {};
    const eventDate = toIso(event.officialDate ?? event.officialDeadline);
    if (isOpeningEvent(event.title) && eventDate && !activity.metadata?.opensAt) {
      extra.opensAt = eventDate;
    }
    const points = extractPoints(event.description);
    if (points && !activity.metadata?.points) extra.points = points;
    enrichment.set(activity, extra);
  }

  return candidates.map((candidate) => {
    const extra = enrichment.get(candidate);
    if (extra && Object.keys(extra).length > 0) {
      return { ...candidate, metadata: { ...candidate.metadata, ...extra } };
    }
    if (candidate.metadata?.origin !== 'EAD_CALENDAR') return candidate;
    const discipline = candidate.discipline
      ? (disciplineByCode.get(candidate.discipline) ?? candidate.discipline)
      : undefined;
    const match = matches.get(candidate);
    return {
      ...candidate,
      ...(discipline ? { discipline } : {}),
      ...(match
        ? {
            metadata: {
              ...candidate.metadata,
              contextOnly: 'true',
              duplicateOf: match.externalId,
            },
          }
        : {}),
    };
  });
}

export function parseMoodleCalendar(ics: string): DetectedItemCandidate[] {
  const unfolded = ics.replace(/\r?\n[ \t]/g, '');
  return [...unfolded.matchAll(/BEGIN:VEVENT\r?\n([\s\S]*?)\r?\nEND:VEVENT/g)].flatMap((match) => {
    const event = parseEvent(match[1] ?? '');
    if (!event) return [];
    const type = inferItemType(`${event.summary} ${event.description}`);
    const opening = isOpeningEvent(event.summary);
    const trackable = !opening && ['EXAM', 'ASSIGNMENT', 'AOP', 'DOCUMENT'].includes(type);
    const discipline = disciplineFor(event);
    return [
      {
        externalId: `ead-calendar:${event.uid}`,
        source: 'PORTAL' as const,
        sourceUrl: event.url ?? DEFAULT_MOODLE_CALENDAR_URL,
        ...(discipline ? { discipline } : {}),
        title: event.summary,
        description: event.description,
        type,
        ...(trackable ? { officialDeadline: event.startsAt } : { officialDate: event.startsAt }),
        status: statusFor(type),
        metadata: {
          origin: 'EAD_CALENDAR',
          moodleCalendarUid: event.uid,
          ...(opening ? { contextOnly: 'true', calendarPhase: 'OPEN' } : {}),
        },
      },
    ];
  });
}

export async function collectMoodleCalendar(
  calendarUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<DetectedItemCandidate[]> {
  const url = new URL(calendarUrl);
  if (url.protocol !== 'https:' || url.hostname !== 'saladeaula.ead.uvv.br') {
    throw new Error('MOODLE_CALENDAR_URL deve apontar para o domínio oficial do Ambiente Virtual.');
  }
  const response = await fetcher(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok)
    throw new Error(`Calendário EAD respondeu com HTTP ${String(response.status)}.`);
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('text/calendar')) {
    throw new Error('O Ambiente Virtual não retornou um calendário iCalendar válido.');
  }
  return parseMoodleCalendar(await response.text());
}
