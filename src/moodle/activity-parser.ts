import type { PortalItem } from '../portal/models.js';
import { inferItemType } from '../portal/parsers.js';

export interface MoodleActivityInput {
  courseTitle: string;
  title: string;
  url: string;
  text: string;
  completion: string;
}

const months: Record<string, string> = {
  jan: '01',
  fev: '02',
  mar: '03',
  abr: '04',
  mai: '05',
  jun: '06',
  jul: '07',
  ago: '08',
  set: '09',
  out: '10',
  nov: '11',
  dez: '12',
};

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function cleanMoodleCourseTitle(value: string): string {
  const cleaned = clean(value)
    .replace(/^Curso é favorito\s+Nome do curso\s+/i, '')
    .replace(/\s+Curso não é favorito$/i, '');
  return /^(.+?)\s+\1$/.exec(cleaned)?.[1] ?? cleaned;
}

export function extractMoodleDeadline(text: string): string | undefined {
  const normalized = text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
  const match =
    /(?:vencimento|fechar|encerra(?:mento)?)\s*:\s*(?:[a-z]+-feira,\s*)?(\d{1,2})\s+(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\.?\s+(\d{4}),\s*(\d{1,2}):(\d{2})/i.exec(
      normalized,
    );
  if (!match?.[1] || !match[2] || !match[3] || !match[4] || !match[5]) return undefined;
  return `${match[3]}-${months[match[2]]}-${match[1].padStart(2, '0')}T${match[4].padStart(2, '0')}:${match[5]}:00`;
}

export function parseMoodleActivity(input: MoodleActivityInput): PortalItem | undefined {
  const url = new URL(input.url);
  const activityId = url.searchParams.get('id');
  if (!activityId || !url.pathname.startsWith('/mod/')) return undefined;
  const title = clean(input.title);
  if (!title) return undefined;
  const description = clean(input.text) || title;
  const type = inferItemType(`${title} ${description}`);
  const officialDeadline = extractMoodleDeadline(description);
  const completion = clean(input.completion);
  const nonGradedExercise =
    /exerc[ií]cio de fixa[cç][aã]o/i.test(title) || /n[aã]o [ée] pontuad[oa]/i.test(description);
  const contextOnly =
    type === 'NOTICE' ||
    /conclu[ií]do|marcar como n[aã]o feito/i.test(completion) ||
    nonGradedExercise;
  return {
    externalId: `ead:${url.pathname}:${activityId}`,
    origin: 'EAD',
    sourceUrl: input.url,
    discipline: cleanMoodleCourseTitle(input.courseTitle),
    title,
    description,
    type,
    ...(officialDeadline ? { officialDeadline } : {}),
    status: completion,
    links: [input.url],
    metadata: {
      moodleActivityId: activityId,
      moodleModule: url.pathname.split('/')[2] ?? '',
      completion,
      ...(nonGradedExercise ? { graded: 'false' } : {}),
      ...(contextOnly ? { contextOnly: 'true' } : {}),
    },
  };
}
