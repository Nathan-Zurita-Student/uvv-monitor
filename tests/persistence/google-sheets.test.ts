import { describe, expect, it } from 'vitest';
import type { AcademicItem } from '../../src/models/academic-item.js';
import { academicItemFromRow, academicItemToRow } from '../../src/persistence/google-sheets.js';

describe('serialização da persistência no Google Sheets', () => {
  it('faz round-trip de um item completo', () => {
    const item: AcademicItem = {
      id: 'UVV-ABC123',
      externalId: 'post:123',
      source: 'PORTAL',
      sourceUrl: 'https://aluno.uvv.br/Aluno/Post/123',
      discipline: 'Cálculo',
      title: 'AOP',
      description: 'Exercícios',
      type: 'AOP',
      officialDeadline: '2026-10-02T23:59:00-03:00',
      firstSeenAt: '2026-09-30T12:00:00-03:00',
      lastSeenAt: '2026-09-30T17:00:00-03:00',
      contentHash: 'hash',
      previousHash: 'old-hash',
      calendarEventId: 'event-1',
      status: 'IN_PROGRESS',
      urgency: 'NEXT_72_HOURS',
      metadata: { origin: 'CLASS_POST' },
    };
    expect(academicItemFromRow(academicItemToRow(item))).toEqual(item);
  });
});
