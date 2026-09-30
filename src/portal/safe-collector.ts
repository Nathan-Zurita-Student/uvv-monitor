import type { Page } from 'playwright';
import type { DetectedItemCandidate } from '../persistence/deduplication.js';
import {
  collectCalendarEvents,
  collectClassPosts,
  collectEadActivities,
  collectMessages,
  collectRegularSchedule,
  collectServiceHistory,
} from './collectors.js';
import { portalItemToCandidate } from './to-academic-item.js';

export interface SafePortalCollection {
  items: DetectedItemCandidate[];
  errors: string[];
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

export async function collectPortalSafely(page: Page): Promise<SafePortalCollection> {
  const items: DetectedItemCandidate[] = [];
  const errors: string[] = [];
  const collectors = [
    ['Mensagens', collectMessages],
    ['Turmas', collectClassPosts],
    ['AVA/EAD', collectEadActivities],
    ['Atendimento', collectServiceHistory],
    ['Calendário', collectCalendarEvents],
    ['Horários', collectRegularSchedule],
  ] as const;
  for (const [name, collector] of collectors) {
    try {
      items.push(...(await collector(page)).map(portalItemToCandidate));
    } catch (error) {
      errors.push(`${name}: ${error instanceof Error ? error.message : 'erro desconhecido'}`);
    }
  }
  return { items: reconcilePortalDuplicates(items), errors };
}
