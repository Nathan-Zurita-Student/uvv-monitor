import { describe, expect, it } from 'vitest';
import { hubSyncAuthorized, studentHubPayload } from '../../src/gas/hub-sync.js';
import type { Snapshot } from '../../src/gas/snapshot.js';
import { academicItemToRow } from '../../src/persistence/rows.js';
import type { AcademicItem } from '../../src/models/academic-item.js';
import { portalDocumentToRow } from '../../src/models/portal-document.js';

const token = 'a'.repeat(64);

describe('sincronização somente leitura com o Student Hub', () => {
  it('exige uma chave longa e idêntica', () => {
    expect(hubSyncAuthorized(token, token)).toBe(true);
    expect(hubSyncAuthorized('errada', token)).toBe(false);
    expect(hubSyncAuthorized(token, null)).toBe(false);
    expect(
      hubSyncAuthorized(
        token,
        null,
        () => '36dd6a1d749c8ba328679ab092b6d4cd59d102a3e9febc294747c9bd5df3da29',
      ),
    ).toBe(true);
  });

  it('expõe itens normalizados e o estado da última coleta', () => {
    const item: AcademicItem = {
      id: 'UVV-TESTE',
      externalId: 'ava:1',
      source: 'PORTAL',
      sourceUrl: 'https://example.test/item/1',
      discipline: 'Algoritmos',
      title: 'AOP 1',
      description: 'Resolver exercícios.',
      type: 'AOP',
      officialDeadline: '2026-10-20T23:59:00-03:00',
      firstSeenAt: '2026-10-11T12:00:00Z',
      lastSeenAt: '2026-10-11T12:00:00Z',
      contentHash: 'hash',
      status: 'TODO',
      urgency: 'THIS_WEEK',
    };
    const snapshot: Snapshot = {
      builtAt: '2026-10-11T12:00:00Z',
      lastSyncAt: '2026-10-11T12:00:00Z',
      lastRun: { portal: 'SUCCESS', gmail: 'SUCCESS', calendar: 'SUCCESS' },
      items: [academicItemToRow(item)],
      statuses: [],
      reminders: [],
      batches: [],
      personal: [],
      memory: [],
      classes: [],
      files: [
        portalDocumentToRow({
          id: 'doc:pdf',
          postExternalId: 'post:1',
          discipline: 'Algoritmos',
          postTitle: 'Aula 1',
          publishedOn: '2026-10-10',
          fileName: 'aula.pdf',
          url: 'https://aluno.uvv.br/aula.pdf',
          contentType: 'application/pdf',
          sizeBytes: 100,
          sha256: 'pdf',
          pages: 0,
          status: 'baixado',
          fetchedAt: '2026-10-11T12:00:00Z',
          telegramFileId: '',
          sentAt: '',
        }),
        portalDocumentToRow({
          id: 'doc:foto',
          postExternalId: 'post:2',
          discipline: 'Algoritmos',
          postTitle: 'Presença',
          publishedOn: '2026-10-10',
          fileName: 'presenca.jpg',
          url: 'https://aluno.uvv.br/presenca.jpg',
          contentType: 'image/jpeg',
          sizeBytes: 100,
          sha256: 'foto',
          pages: 0,
          status: 'baixado',
          fetchedAt: '2026-10-11T12:00:00Z',
          telegramFileId: '',
          sentAt: '',
        }),
      ],
    };
    const payload = studentHubPayload(snapshot);
    expect(payload.version).toBe(1);
    expect(payload.items).toMatchObject([{ id: 'UVV-TESTE', type: 'AOP' }]);
    expect(payload.files).toMatchObject([{ id: 'doc:pdf', fileName: 'aula.pdf' }]);
    expect(payload.lastRun?.portal).toBe('SUCCESS');
  });
});
