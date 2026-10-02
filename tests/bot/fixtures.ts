import type { AcademicItem } from '../../src/models/academic-item.js';

/** Sexta-feira, 02/10/2026, 12h em São Paulo. */
export const now = new Date('2026-10-02T15:00:00Z');
export const chatId = '42';

type Overrides = { [K in keyof AcademicItem]?: AcademicItem[K] | undefined };

let sequence = 0;

export function item(overrides: Overrides = {}): AcademicItem {
  sequence += 1;
  const merged = {
    id: `UVV-${String(sequence).padStart(6, '0')}`,
    externalId: String(sequence),
    source: 'PORTAL' as const,
    sourceUrl: 'https://saladeaula.ead.uvv.br/mod/quiz/view.php?id=8603',
    discipline: 'Aspectos Legais da Tecnologia da Informação',
    title: 'Atividade Online Pontuada 03',
    description:
      'Questionário Abre: terça-feira, 6 out. 2026, 00:00 Fecha: terça-feira, 13 out. 2026, 23:59',
    type: 'ASSIGNMENT' as const,
    officialDeadline: '2026-10-13T23:59:00',
    firstSeenAt: '2026-10-01T12:00:00Z',
    lastSeenAt: '2026-10-01T12:00:00Z',
    contentHash: 'hash',
    status: 'TODO' as const,
    urgency: 'FUTURE' as const,
    metadata: {
      origin: 'EAD',
      moodleModule: 'quiz',
      opensAt: '2026-10-06T00:00:00',
      points: '2',
    },
    ...overrides,
  };
  // Remove campos sobrescritos com undefined (exactOptionalPropertyTypes).
  return Object.fromEntries(
    Object.entries(merged).filter(([, value]) => value !== undefined),
  ) as unknown as AcademicItem;
}

export function exam(overrides: Overrides = {}): AcademicItem {
  return item({
    externalId: `exam-schedule:CC6N:FIRST_TERM:${String(sequence)}`,
    sourceUrl: 'https://aluno.uvv.br/Aluno/Mensagem/1',
    discipline: 'Linguagens Formais e Autômatos',
    title: 'Prova do 1º bimestre — Linguagens Formais e Autômatos',
    description: 'Calendário oficial de provas.',
    type: 'EXAM',
    officialDeadline: undefined,
    officialDate: '2026-10-05',
    metadata: { origin: 'MESSAGE', assessment: 'FIRST_TERM' },
    ...overrides,
  });
}
