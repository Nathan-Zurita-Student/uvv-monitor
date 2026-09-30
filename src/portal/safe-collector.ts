import type { Page } from 'playwright';
import type { DetectedItemCandidate } from '../persistence/deduplication.js';
import {
  collectCalendarEvents,
  collectClassPosts,
  collectMessages,
  collectRegularSchedule,
  collectServiceHistory,
} from './collectors.js';
import { portalItemToCandidate } from './to-academic-item.js';

export interface SafePortalCollection {
  items: DetectedItemCandidate[];
  errors: string[];
}

export async function collectPortalSafely(page: Page): Promise<SafePortalCollection> {
  const items: DetectedItemCandidate[] = [];
  const errors: string[] = [];
  const collectors = [
    ['Mensagens', collectMessages],
    ['Turmas', collectClassPosts],
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
  return { items, errors };
}
