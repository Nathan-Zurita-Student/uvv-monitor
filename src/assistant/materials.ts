import { normalizeDiscipline, sameDiscipline } from '../models/class-schedule.js';
import type { PortalDocument } from '../models/portal-document.js';

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

export function materialListing(document: PortalDocument) {
  return {
    id: document.id,
    name: document.fileName,
    discipline: document.discipline,
    post: document.postTitle,
    ...(document.publishedOn ? { published: document.publishedOn } : {}),
    sentToChat: Boolean(document.telegramFileId),
  };
}
