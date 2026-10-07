import { describe, expect, it } from 'vitest';
import {
  extractPortalDates,
  parseMessageContent,
  parseMessageLinks,
} from '../../src/portal/parsers.js';

const body =
  'Você possuí uma prova agendada para o dia 31/10/2026:08:00, no seguinte local Campus Boa Vista / Unidade Acadêmica I (Branco) - 2º Piso - SALA 18';

describe('agendamento oficial EAD observado no Portal', () => {
  it('preserva o conteúdo, hora, local e ID do aviso sem inferir disciplina', () => {
    const summary = parseMessageLinks([
      {
        text: 'Agendamento Provas EAD 20% 07out',
        href: 'https://aluno.uvv.br/Aluno/Mensagens/?mId=KJQUNpJPeiU=',
      },
    ])[0]!;
    const result = parseMessageContent(summary, body, [], 2026);
    expect(result).toMatchObject({
      externalId: 'message:KJQUNpJPeiU=',
      type: 'EXAM',
      officialDate: '2026-10-31T08:00:00',
      description: body,
      metadata: {
        location: 'Campus Boa Vista / Unidade Acadêmica I (Branco) - 2º Piso - SALA 18',
        officialExamAppointment: 'true',
      },
    });
    expect(result.discipline).toBeUndefined();
  });
  it.each([
    ['Prova no dia 31/10/2026 às 08:00', '2026-10-31T08:00:00'],
    ['Prova no dia 31/10/2026, às 08h00', '2026-10-31T08:00:00'],
    ['Prova no dia 31/10/2026', '2026-10-31'],
    ['Prova no dia 31/10/2026:25:99', '2026-10-31'],
    ['Prova no dia 31 de outubro de 2026 às 08h00', '2026-10-31T08:00:00'],
  ])('normaliza data e horário: %s', (text, expected) => {
    expect(extractPortalDates(text, 'EXAM', 2026).officialDate).toBe(expected);
  });
  it('não aceita só o assunto quando o corpo da mensagem não foi carregado', () => {
    const summary = parseMessageLinks([
      { text: 'Prova', href: 'https://aluno.uvv.br/Aluno/Mensagens/?mId=1' },
    ])[0]!;
    expect(() => parseMessageContent(summary, '', [], 2026)).toThrow('Conteúdo');
  });
});
