import type { Page } from 'playwright';
import type { ClassSlot } from '../models/class-schedule.js';
import type { DownloadedDocument } from '../telegram/portal-files.js';
import type { DetectedItemCandidate } from '../persistence/deduplication.js';
import {
  collectCalendarEvents,
  collectClassPosts,
  collectClassSchedule,
  collectEadActivities,
  collectGrades,
  collectMessages,
  collectRegularSchedule,
  collectServiceHistory,
  downloadPostDocuments,
} from './collectors.js';
import type { PortalItem } from './models.js';
import { portalItemToCandidate } from './to-academic-item.js';

export interface SafePortalCollection {
  items: DetectedItemCandidate[];
  errors: string[];
  /** Quadro de horários lido nesta coleta (ausente se a página falhou). */
  schedule?: ClassSlot[];
  /** Arquivos de posts baixados nesta coleta (com o conteúdo em memória para o envio). */
  documents: DownloadedDocument[];
}

function normalized(value: string | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/^\w+\s*-\s*/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function significantTokens(value: string): Set<string> {
  return new Set(
    normalized(value)
      .split(' ')
      .filter((token) => token.length >= 5),
  );
}

export function reconcilePortalDuplicates(items: DetectedItemCandidate[]): DetectedItemCandidate[] {
  const classPosts = items.filter((item) => item.metadata?.origin === 'CLASS_POST');
  return items.map((item) => {
    if (item.metadata?.origin !== 'CALENDAR') return item;
    const itemDate = (item.officialDeadline ?? item.officialDate ?? '').slice(0, 10);
    if (!itemDate) return item;
    const itemDiscipline = normalized(item.discipline);
    const itemTokens = significantTokens(item.title);
    const duplicate = classPosts.find((post) => {
      const postDate = (post.officialDeadline ?? post.officialDate ?? '').slice(0, 10);
      const postDiscipline = normalized(post.discipline);
      const sameDiscipline =
        itemDiscipline &&
        postDiscipline &&
        (itemDiscipline.includes(postDiscipline) || postDiscipline.includes(itemDiscipline));
      const postText = normalized(`${post.title} ${post.description}`);
      const sharedTitle = [...itemTokens].some((token) => postText.includes(token));
      return sameDiscipline && itemDate === postDate && sharedTitle;
    });
    if (!duplicate) return item;
    return {
      ...item,
      metadata: {
        ...item.metadata,
        contextOnly: 'true',
        duplicateOf: duplicate.externalId,
      },
    };
  });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'erro desconhecido';
}

export async function collectPortalSafely(
  page: Page,
  options: { knownDocumentIds?: ReadonlySet<string>; now?: Date } = {},
): Promise<SafePortalCollection> {
  const now = options.now ?? new Date();
  const items: DetectedItemCandidate[] = [];
  const posts: PortalItem[] = [];
  const errors: string[] = [];
  const collectors: Array<readonly [string, (page: Page) => Promise<PortalItem[]>]> = [
    [
      'Mensagens',
      (current) => collectMessages(current, (error) => errors.push(`Mensagens: ${error}`)),
    ],
    ['Turmas', async (current) => (await collectClassPosts(current, now)).map(keep(posts))],
    ['AVA/EAD', collectEadActivities],
    ['Atendimento', collectServiceHistory],
    ['Calendário', collectCalendarEvents],
    ['Desempenho', collectGrades],
    ['Horários', collectRegularSchedule],
  ];
  for (const [name, collector] of collectors) {
    try {
      items.push(...(await collector(page)).map(portalItemToCandidate));
    } catch (error) {
      errors.push(`${name}: ${message(error)}`);
    }
  }

  let schedule: ClassSlot[] | undefined;
  try {
    schedule = await collectClassSchedule(page);
    if (schedule.length === 0)
      errors.push('Quadro de horários: nenhuma aula encontrada na página.');
  } catch (error) {
    errors.push(`Quadro de horários: ${message(error)}`);
  }

  let documents: DownloadedDocument[] = [];
  try {
    documents = await downloadPostDocuments(
      page,
      posts,
      options.knownDocumentIds ?? new Set<string>(),
      now,
    );
  } catch (error) {
    errors.push(`Arquivos dos posts: ${message(error)}`);
  }

  return {
    items: reconcilePortalDuplicates(items),
    errors,
    ...(schedule && schedule.length > 0 ? { schedule } : {}),
    documents,
  };
}

function keep(target: PortalItem[]): (item: PortalItem) => PortalItem {
  return (item) => {
    target.push(item);
    return item;
  };
}
