import { describe, expect, it } from 'vitest';
import { parseGradeTables } from '../../src/portal/collectors.js';

describe('boletim do Portal UVV', () => {
  it('transforma cada indicador em um registro de desempenho por disciplina', () => {
    const result = parseGradeTables(
      [
        {
          context: 'Boletim',
          headers: ['Disciplina', 'Nota 1', 'AOP', 'Média', 'Faltas', 'Situação'],
          rows: [['Desenvolvimento Mobile', '8,5', '9,0', '8,7', '2', 'Aprovado']],
        },
      ],
      'https://aluno.uvv.br/Boletim/Aluno/teste',
    );
    expect(result).toHaveLength(5);
    expect(result[0]).toMatchObject({
      discipline: 'Desenvolvimento Mobile',
      type: 'GRADE',
      metadata: { assessment: 'Nota 1', grade: '8,5', gradeStatus: 'Aprovado' },
    });
    expect(result.map((item) => item.metadata.grade)).toContain('2');
  });

  it('usa o título do painel quando a disciplina não é uma coluna', () => {
    const result = parseGradeTables(
      [
        {
          context: 'Cálculo Numérico',
          headers: ['Avaliação', 'Resultado'],
          rows: [['Prova 1', '7,4']],
        },
      ],
      'https://aluno.uvv.br/Boletim/Aluno/teste',
    );
    expect(result).toMatchObject([
      { discipline: 'Cálculo Numérico', metadata: { assessment: 'Prova 1', grade: '7,4' } },
    ]);
  });

  it('ignora a linha de cabeçalho repetida dentro do corpo da tabela', () => {
    const result = parseGradeTables(
      [
        {
          context: '',
          headers: ['Período', 'Disciplina', 'Resultado'],
          rows: [
            ['Período', 'Disciplina', 'Resultado'],
            ['2026/2', 'Desenvolvimento de Games', 'Cursando'],
          ],
        },
      ],
      'https://aluno.uvv.br/Boletim/Aluno/teste',
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.discipline).toBe('Desenvolvimento de Games');
  });

  it('preserva todas as colunas e disciplinas do boletim matricial, inclusive notas ainda vazias', () => {
    const result = parseGradeTables(
      [{ context: '', headers: ['Período', 'Turma', 'Disciplina', 'AV1', 'TF1', 'AV2', 'TF2', 'MP', 'PF', 'TF', 'Final', 'Resultado'], rows: [
        ['2026/2', 'CC6N', 'Cálculo Numérico Computacional', '-', '-', '-', '-', '-', '-', '-', '-', '-'],
        ['2026/2', 'CC6N', 'Desenvolvimento de Games', '-', '6', '-', '-', '-', '-', '6', '-', 'Cursando'],
      ] }],
      'https://aluno.uvv.br/Boletim/Aluno/teste',
    );
    expect(new Set(result.map((item) => item.discipline))).toEqual(new Set(['Cálculo Numérico Computacional', 'Desenvolvimento de Games']));
    expect(result.find((item) => item.discipline === 'Cálculo Numérico Computacional' && item.title === 'AV1')?.description).toBe('-');
    expect(result.find((item) => item.discipline === 'Desenvolvimento de Games' && item.title === 'TF1')?.description).toBe('6');
  });
});
