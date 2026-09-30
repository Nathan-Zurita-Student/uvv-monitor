import type { DetectedItemCandidate } from '../persistence/deduplication.js';
import type { PortalItem } from './models.js';

export function portalItemToCandidate(item: PortalItem): DetectedItemCandidate {
  const deadline = item.origin === 'CALENDAR' && item.metadata.portalEventType === '1';
  return {
    externalId: item.externalId,
    source: 'PORTAL',
    sourceUrl: item.sourceUrl,
    ...(item.discipline ? { discipline: item.discipline } : {}),
    title: item.title,
    description: item.description,
    type: item.type,
    ...(item.officialDate && !deadline ? { officialDate: item.officialDate } : {}),
    ...(item.officialDeadline
      ? { officialDeadline: item.officialDeadline }
      : item.officialDate && deadline
        ? { officialDeadline: item.officialDate }
        : {}),
    status: item.type === 'NOTICE' || item.type === 'MESSAGE' ? 'WAITING' : 'TODO',
    metadata: { ...item.metadata, origin: item.origin, portalStatus: item.status ?? '' },
  };
}
