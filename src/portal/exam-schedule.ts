import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PortalItem } from './models.js';

export interface PositionedPdfText {
  text: string;
  x: number;
  y: number;
  page?: number;
}

const assessmentColumns = [
  { key: 'FIRST_TERM', label: 'Prova do 1º bimestre', minX: 525, maxX: 590 },
  { key: 'SECOND_TERM', label: 'Prova do 2º bimestre', minX: 590, maxX: 660 },
  { key: 'SECOND_CALL', label: 'Prova de 2ª chamada', minX: 660, maxX: 725 },
  { key: 'FINAL', label: 'Prova final', minX: 725, maxX: Number.POSITIVE_INFINITY },
] as const;

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeCohort(value: string): string {
  return clean(value).replace(/\.$/, '').toUpperCase();
}

function normalizeDiscipline(value: string): string {
  return clean(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
}

function dateFromCell(value: string, year: number): string | undefined {
  const match = /^(\d{1,2})\/(\d{1,2})$/.exec(clean(value));
  if (!match?.[1] || !match[2]) return undefined;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }
  return `${String(year)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function joinColumn(row: PositionedPdfText[], minX: number, maxX: number): string {
  return clean(
    row
      .filter((item) => item.x >= minX && item.x < maxX)
      .sort((left, right) => left.x - right.x)
      .map((item) => item.text)
      .join(' '),
  );
}

function groupRows(items: PositionedPdfText[]): PositionedPdfText[][] {
  const rows: Array<{ page: number; y: number; items: PositionedPdfText[] }> = [];
  for (const item of [...items].sort(
    (left, right) => (left.page ?? 0) - (right.page ?? 0) || right.y - left.y || left.x - right.x,
  )) {
    const page = item.page ?? 0;
    const row = rows.find(
      (candidate) => candidate.page === page && Math.abs(candidate.y - item.y) <= 2,
    );
    if (row) row.items.push(item);
    else rows.push({ page, y: item.y, items: [item] });
  }
  return rows.map((row) => row.items);
}

export function parseExamScheduleTextItems(
  items: PositionedPdfText[],
  enrolledClasses: ReadonlyMap<string, ReadonlySet<string>>,
  referenceYear: number,
  sourceUrl: string,
  documentUrl: string,
): PortalItem[] {
  const classes = new Map(
    [...enrolledClasses].map(([cohort, disciplines]) => [
      normalizeCohort(cohort),
      new Set([...disciplines].map(normalizeDiscipline)),
    ]),
  );
  const results: PortalItem[] = [];
  for (const row of groupRows(items)) {
    const cohort = normalizeCohort(joinColumn(row, 135, 180));
    const enrolledDisciplines = classes.get(cohort);
    if (!enrolledDisciplines) continue;
    const discipline = joinColumn(row, 180, 430);
    const professor = joinColumn(row, 430, 525);
    if (!discipline || !enrolledDisciplines.has(normalizeDiscipline(discipline))) continue;
    for (const assessment of assessmentColumns) {
      const officialDate = dateFromCell(
        joinColumn(row, assessment.minX, assessment.maxX),
        referenceYear,
      );
      if (!officialDate) continue;
      results.push({
        externalId: `exam-schedule:${cohort}:${assessment.key}:${discipline}`,
        origin: 'MESSAGE',
        sourceUrl,
        discipline,
        title: `${assessment.label} — ${discipline}`,
        description: `Calendário oficial de provas da turma ${cohort}. ${assessment.label}${professor ? ` — professor(a): ${professor}` : ''}.`,
        type: 'EXAM',
        officialDate,
        ...(professor ? { professor } : {}),
        links: [sourceUrl, documentUrl],
        metadata: {
          origin: 'OFFICIAL_EXAM_SCHEDULE',
          cohort,
          assessment: assessment.key,
          documentUrl,
          ...(professor ? { professor } : {}),
        },
      });
    }
  }
  return results;
}

export async function parseExamSchedulePdf(
  bytes: Uint8Array,
  enrolledClasses: ReadonlyMap<string, ReadonlySet<string>>,
  referenceYear: number,
  sourceUrl: string,
  documentUrl: string,
): Promise<PortalItem[]> {
  const document = await getDocument({ data: bytes }).promise;
  const items: PositionedPdfText[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      for (const entry of content.items) {
        if (!('str' in entry) || !entry.str.trim()) continue;
        const transform = entry.transform as unknown;
        if (!Array.isArray(transform)) continue;
        const x = Number(transform[4]);
        const y = Number(transform[5]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        items.push({ text: entry.str, x, y, page: pageNumber });
      }
    }
  } finally {
    await document.destroy();
  }
  return parseExamScheduleTextItems(items, enrolledClasses, referenceYear, sourceUrl, documentUrl);
}
