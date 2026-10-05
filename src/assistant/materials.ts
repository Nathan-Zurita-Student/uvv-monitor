import { normalizeDiscipline, sameDiscipline } from '../models/class-schedule.js';
import type { PortalDocument } from '../models/portal-document.js';

const STOPWORDS = new Set([
  'que',
  'para',
  'com',
  'uma',
  'por',
  'dos',
  'das',
  'como',
  'mais',
  'sobre',
  'material',
  'arquivo',
  'pdf',
  'professor',
  'aula',
]);

/** Mesmo comprimento do texto original: cada posição do texto "dobrado" é a mesma do original. */
function fold(text: string): string {
  return text
    .split('')
    .map(
      (char) =>
        char
          .normalize('NFD')
          .replace(/\p{Diacritic}/gu, '')
          .toLowerCase()[0] ?? ' ',
    )
    .join('');
}

function terms(query: string): string[] {
  return [
    ...new Set(
      fold(query)
        .split(/[^a-z0-9]+/)
        .filter((term) => term.length >= 3 && !STOPWORDS.has(term)),
    ),
  ];
}

export function documentsOfDiscipline(
  documents: readonly PortalDocument[],
  discipline: string | undefined,
): PortalDocument[] {
  if (!discipline) return [...documents];
  const wanted = normalizeDiscipline(discipline);
  return documents.filter(
    (document) =>
      sameDiscipline(document.discipline, discipline) ||
      normalizeDiscipline(document.discipline).includes(wanted),
  );
}

export interface MaterialHit {
  document: PortalDocument;
  score: number;
  excerpts: string[];
}

/**
 * Procura nos arquivos dos professores: nome do arquivo e título do post valem mais; no texto,
 * conta as ocorrências. Devolve trechos do texto original ao redor das ocorrências.
 */
export function searchMaterials(
  documents: readonly PortalDocument[],
  query: string,
  options: { maxDocuments?: number; maxExcerpts?: number; excerptLength?: number } = {},
): MaterialHit[] {
  const wanted = terms(query);
  if (wanted.length === 0) return [];
  const maxExcerpts = options.maxExcerpts ?? 3;
  const length = options.excerptLength ?? 900;
  const hits: MaterialHit[] = [];
  for (const document of documents) {
    const text = document.text ?? '';
    const folded = fold(text);
    const header = fold(`${document.fileName} ${document.postTitle}`);
    let score = 0;
    const positions: number[] = [];
    for (const term of wanted) {
      if (header.includes(term)) score += 5;
      let index = folded.indexOf(term);
      let count = 0;
      while (index >= 0 && count < 50) {
        count += 1;
        positions.push(index);
        index = folded.indexOf(term, index + term.length);
      }
      score += Math.min(count, 10);
    }
    if (score === 0) continue;
    // Trechos onde mais termos aparecem juntos vêm primeiro, sem sobreposição.
    const ranked = positions
      .map((position) => ({
        position,
        density: positions.filter((other) => Math.abs(other - position) < length / 2).length,
      }))
      .sort((left, right) => right.density - left.density || left.position - right.position);
    const excerpts: string[] = [];
    const used: number[] = [];
    for (const { position } of ranked) {
      if (excerpts.length >= maxExcerpts) break;
      if (used.some((start) => Math.abs(start - position) < length)) continue;
      used.push(position);
      const start = Math.max(0, position - Math.floor(length / 3));
      const end = Math.min(text.length, start + length);
      excerpts.push(
        `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`,
      );
    }
    if (excerpts.length === 0 && text) excerpts.push(text.slice(0, length));
    hits.push({ document, score, excerpts });
  }
  return hits.sort((left, right) => right.score - left.score).slice(0, options.maxDocuments ?? 3);
}

export function materialListing(document: PortalDocument) {
  return {
    id: document.id,
    name: document.fileName,
    discipline: document.discipline,
    post: document.postTitle,
    status: document.status,
    ...(document.pages ? { pages: document.pages } : {}),
    ...(document.text ? { characters: document.text.length } : {}),
  };
}
