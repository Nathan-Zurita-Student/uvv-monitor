import { describe, expect, it, vi } from 'vitest';
import type { AcademicItem } from '../../src/models/academic-item.js';
import {
  academicItemFromRow,
  academicItemToRow,
  GoogleSheetsAcademicRepository,
} from '../../src/persistence/google-sheets.js';

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

  it('atualiza várias linhas em uma única requisição de escrita', async () => {
    const existing: AcademicItem = {
      id: 'UVV-ABC123',
      externalId: 'post:123',
      source: 'PORTAL',
      sourceUrl: 'https://aluno.uvv.br/Aluno/Post/123',
      title: 'Atividade',
      description: 'Descrição',
      type: 'ASSIGNMENT',
      firstSeenAt: '2026-09-30T12:00:00-03:00',
      lastSeenAt: '2026-09-30T17:00:00-03:00',
      contentHash: 'hash',
      status: 'TODO',
      urgency: 'FUTURE',
    };
    const second = { ...existing, id: 'UVV-DEF456', externalId: 'post:456' };
    const get = vi.fn().mockResolvedValue({
      data: { values: [academicItemToRow(existing), academicItemToRow(second)] },
    });
    const batchUpdate = vi.fn().mockResolvedValue({});
    const append = vi.fn().mockResolvedValue({});
    const repository = new GoogleSheetsAcademicRepository(
      { spreadsheets: { values: { get, batchUpdate, append } } } as never,
      'sheet-id',
    );

    await repository.upsertDetectedItems([
      { ...existing, title: 'Atividade atualizada' },
      { ...second, title: 'Outra atividade atualizada' },
    ]);

    expect(batchUpdate).toHaveBeenCalledTimes(1);
    expect(append).not.toHaveBeenCalled();
  });
});
