import { describe, expect, it } from 'vitest';
import { buildAcademicPrompt, redactAcademicText } from '../../src/ai/prompt.js';
import type { AcademicItem } from '../../src/models/academic-item.js';

const item: AcademicItem = {
  id: 'UVV-TESTE',
  externalId: 'post:1',
  source: 'PORTAL',
  sourceUrl: 'https://aluno.uvv.br/Aluno/Post/1',
  discipline: 'Cálculo',
  title: 'Prova P1',
  description: 'Estudar unidades 1 a 4. Contato aluno@example.com. Matrícula 123456789.',
  type: 'EXAM',
  officialDate: '2026-10-05',
  firstSeenAt: '2026-10-01T12:00:00Z',
  lastSeenAt: '2026-10-01T12:00:00Z',
  contentHash: 'hash',
  status: 'TODO',
  urgency: 'THIS_WEEK',
};

describe('prompt acadêmico', () => {
  it('remove identificadores pessoais antes de enviar ao provedor', () => {
    const redacted = redactAcademicText(item.description);
    expect(redacted).not.toContain('aluno@example.com');
    expect(redacted).not.toContain('123456789');
  });

  it('explicita que a IA não pode inventar informações', () => {
    const prompt = buildAcademicPrompt({ item, maxInputCharacters: 20_000 });
    expect(prompt).toContain('Nunca invente datas');
    expect(prompt).toContain('Estudar unidades 1 a 4');
    expect(prompt).not.toContain('aluno@example.com');
  });

  it('informa os valores aceitos e a data de hoje para interpretar prazos', () => {
    const prompt = buildAcademicPrompt({
      item,
      maxInputCharacters: 20_000,
      now: new Date('2026-10-02T15:00:00Z'),
    });
    expect(prompt).toContain('suggestedType: exatamente um destes valores: MESSAGE,');
    expect(prompt).toContain(
      'certainty: exatamente um destes valores: CONFIRMED, INFERRED, NOT_INFORMED',
    );
    expect(prompt).toContain('ACTION_REQUIRED, INFORMATIVE, IRRELEVANT');
    expect(prompt).toContain('Hoje é sexta-feira, 02/10 de 2026.');
    expect(prompt).toContain('trecho copiado literalmente do texto');
  });
});
