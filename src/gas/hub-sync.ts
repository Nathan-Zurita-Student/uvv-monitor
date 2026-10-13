import type { Snapshot } from './snapshot.js';
import { classesOf, filesOf, itemsOf } from './snapshot.js';
import { isImageDocument } from '../models/portal-document.js';
import type { CalendarEvent } from '../assistant/types.js';

export const HUB_SYNC_TOKEN_PROPERTY = 'STUDENT_HUB_SYNC_TOKEN';
const BUILT_IN_HUB_TOKEN_SHA256 =
  '36dd6a1d749c8ba328679ab092b6d4cd59d102a3e9febc294747c9bd5df3da29';

function appsScriptSha256(value: string): string {
  if (typeof Utilities === 'undefined') return '';
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value)
    .map((byte: number) => (byte & 0xff).toString(16).padStart(2, '0'))
    .join('');
}

export function hubSyncAuthorized(
  provided: unknown,
  configured: string | null,
  digest: (value: string) => string = appsScriptSha256,
): boolean {
  if (typeof provided !== 'string' || provided.length < 32) return false;
  if (typeof configured === 'string' && configured.length >= 32 && provided === configured)
    return true;
  return digest(provided) === BUILT_IN_HUB_TOKEN_SHA256;
}

/** Contrato versionado e somente leitura consumido pelo aplicativo desktop. */
export function studentHubPayload(snapshot: Snapshot, calendarEvents: CalendarEvent[] = []) {
  const items = itemsOf(snapshot).filter(
    (item) =>
      item.type !== 'GRADE' || !/^(disciplina|mat[eé]ria)$/i.test(item.discipline?.trim() ?? ''),
  );
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    builtAt: snapshot.builtAt,
    lastRunStartedAt: snapshot.lastRunStartedAt,
    lastSyncAt: snapshot.lastSyncAt,
    lastRun: snapshot.lastRun,
    items,
    classes: classesOf(snapshot),
    files: filesOf(snapshot).filter((file) => !isImageDocument(file.fileName, file.contentType)),
    calendarEvents: calendarEvents.map((event) => ({
      id: event.id,
      title: event.title,
      startsAt: event.start.toISOString(),
      endsAt: event.end.toISOString(),
      allDay: event.allDay,
      description: event.description ?? '',
      location: event.location ?? '',
      academicItemId: event.academicItemId ?? '',
    })),
  };
}
