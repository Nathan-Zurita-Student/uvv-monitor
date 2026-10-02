import type {
  AcademicItem,
  ItemSource,
  ItemStatus,
  ItemType,
  Urgency,
} from '../models/academic-item.js';
import { friendlyItemId, generateContentHash } from '../utils/hash.js';

export interface DetectedItemCandidate {
  externalId: string;
  source: ItemSource;
  sourceUrl: string;
  discipline?: string;
  title: string;
  description: string;
  type: ItemType;
  officialDate?: string;
  officialDeadline?: string;
  status?: ItemStatus;
  urgency?: Urgency;
  metadata?: Record<string, string>;
}

export interface ItemChange {
  field: 'title' | 'description' | 'discipline' | 'officialDate' | 'officialDeadline' | 'status';
  before?: string;
  after?: string;
}

export interface DeduplicationResult {
  newItems: AcademicItem[];
  changedItems: Array<{ item: AcademicItem; changes: ItemChange[] }>;
  unchangedItems: AcademicItem[];
}

function hashCandidate(candidate: DetectedItemCandidate): string {
  const stableMetadata = candidate.metadata
    ? Object.fromEntries(
        Object.entries(candidate.metadata).filter(([key]) => !key.startsWith('ai')),
      )
    : undefined;
  return generateContentHash({
    source: candidate.source,
    externalId: candidate.externalId,
    ...(candidate.discipline ? { discipline: candidate.discipline } : {}),
    title: candidate.title,
    description: candidate.description,
    type: candidate.type,
    ...(candidate.officialDate ? { officialDate: candidate.officialDate } : {}),
    ...(candidate.officialDeadline ? { officialDeadline: candidate.officialDeadline } : {}),
    ...(candidate.status ? { status: candidate.status } : {}),
    ...(stableMetadata ? { metadata: stableMetadata } : {}),
  });
}

function changesBetween(previous: AcademicItem, next: DetectedItemCandidate): ItemChange[] {
  const fields: ItemChange['field'][] = [
    'title',
    'description',
    'discipline',
    'officialDate',
    'officialDeadline',
    'status',
  ];
  return fields.flatMap((field) => {
    const before = previous[field];
    const after = next[field];
    if (before === after) return [];
    return [{ field, ...(before ? { before } : {}), ...(after ? { after } : {}) }];
  });
}

function materialize(
  candidate: DetectedItemCandidate,
  now: string,
  previous?: AcademicItem,
): AcademicItem {
  const contentHash = hashCandidate(candidate);
  const previousAiMetadata = Object.fromEntries(
    Object.entries(previous?.metadata ?? {}).filter(([key]) => key.startsWith('ai')),
  );
  return {
    id: previous?.id ?? friendlyItemId(candidate.source, candidate.externalId),
    externalId: candidate.externalId,
    source: candidate.source,
    sourceUrl: candidate.sourceUrl,
    ...(candidate.discipline ? { discipline: candidate.discipline } : {}),
    title: candidate.title,
    description: candidate.description,
    type: candidate.type,
    ...(candidate.officialDate ? { officialDate: candidate.officialDate } : {}),
    ...(candidate.officialDeadline ? { officialDeadline: candidate.officialDeadline } : {}),
    firstSeenAt: previous?.firstSeenAt ?? now,
    lastSeenAt: now,
    contentHash,
    ...(previous && previous.contentHash !== contentHash
      ? { previousHash: previous.contentHash }
      : previous?.previousHash
        ? { previousHash: previous.previousHash }
        : {}),
    ...(previous?.calendarEventId ? { calendarEventId: previous.calendarEventId } : {}),
    // Status da fonte (AVA/Portal). O do usuário fica em user_task_status e é aplicado na leitura.
    status: candidate.status ?? previous?.status ?? 'TODO',
    urgency: candidate.urgency ?? previous?.urgency ?? 'INFORMATIONAL',
    ...(candidate.metadata || Object.keys(previousAiMetadata).length > 0
      ? { metadata: { ...candidate.metadata, ...previousAiMetadata } }
      : {}),
  };
}

export function deduplicateItems(
  candidates: DetectedItemCandidate[],
  existing: AcademicItem[],
  now = new Date().toISOString(),
): DeduplicationResult {
  const byExternalKey = new Map(
    existing.map((item) => [`${item.source}:${item.externalId}`, item]),
  );
  const newItems: AcademicItem[] = [];
  const changedItems: DeduplicationResult['changedItems'] = [];
  const unchangedItems: AcademicItem[] = [];

  for (const candidate of candidates) {
    const previous = byExternalKey.get(`${candidate.source}:${candidate.externalId}`);
    const item = materialize(candidate, now, previous);
    if (!previous) {
      newItems.push(item);
    } else if (previous.contentHash !== item.contentHash) {
      changedItems.push({ item, changes: changesBetween(previous, candidate) });
    } else {
      unchangedItems.push(item);
    }
  }

  return { newItems, changedItems, unchangedItems };
}
