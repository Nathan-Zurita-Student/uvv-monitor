import { describe, expect, it } from 'vitest';
import { parseExamScheduleTextItems } from '../../src/portal/exam-schedule.js';

describe('calendário oficial de provas', () => {
  it('extrai somente as avaliações das turmas em que o aluno está matriculado', () => {
    const row = (y: number, cohort: string, discipline: string, firstTerm: string) => [
      { text: 'Ciência da Computação', x: 53, y },
      { text: cohort, x: 146, y },
      { text: discipline, x: 187, y },
      { text: 'Saulo', x: 443, y },
      { text: firstTerm, x: 545, y },
      { text: '23/11', x: 608, y },
      { text: '30/11', x: 674, y },
      { text: '7/12', x: 742, y },
    ];
    const items = parseExamScheduleTextItems(
      [
        ...row(254, 'CC6N', 'Linguagens Formais e Autômatos', '5/10'),
        ...row(240, 'CC7N', 'Cybersecurity', '5/10'),
      ],
      new Map([['CC6N', new Set(['Linguagens Formais e Autômatos'])]]),
      2026,
      'https://aluno.uvv.br/Aluno/Mensagens/?mId=calendar',
      'https://sharepoint.example/calendar.pdf',
    );

    expect(items).toHaveLength(4);
    expect(items[0]).toMatchObject({
      discipline: 'Linguagens Formais e Autômatos',
      title: 'Prova do 1º bimestre — Linguagens Formais e Autômatos',
      officialDate: '2026-10-05',
      type: 'EXAM',
    });
    expect(items.every((item) => item.metadata.cohort === 'CC6N')).toBe(true);
  });
});
