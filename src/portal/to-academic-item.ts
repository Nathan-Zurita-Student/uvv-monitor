import type { DetectedItemCandidate } from '../persistence/deduplication.js';
import type { PortalItem } from './models.js';

export function portalItemToCandidate(item: PortalItem): DetectedItemCandidate {
  const deadline = item.origin === 'CALENDAR' && item.metadata.portalEventType === '1';
  const portalStatus = (item.status ?? '').toLowerCase();
  const status =
    item.origin === 'SERVICE' || item.origin === 'EAD'
      ? /conclu[ií]do|marcar como n[aã]o feito/.test(portalStatus)
        ? 'DONE'
        : /cancelado/.test(portalStatus)
          ? 'IGNORED'
          : /aguardando/.test(portalStatus)
            ? 'WAITING'
            : 'TODO'
      : item.origin === 'SCHEDULE' || item.type === 'NOTICE' || item.type === 'MESSAGE'
        ? 'WAITING'
        : 'TODO';
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
    status,
    metadata: { ...item.metadata, origin: item.origin, portalStatus: item.status ?? '' },
  };
}
