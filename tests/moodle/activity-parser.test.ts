import { describe, expect, it } from 'vitest';
import {
  cleanMoodleCourseTitle,
  extractMoodleDeadline,
  parseMoodleActivity,
} from '../../src/moodle/activity-parser.js';

describe('atividades do Moodle', () => {
  it('normaliza o nome repetido da disciplina', () => {
    expect(
      cleanMoodleCourseTitle(
        'Curso é favorito Nome do curso Empreendedorismo e Negócios Empreendedorismo e Negócios',
      ),
    ).toBe('Empreendedorismo e Negócios');
  });

  it('converte vencimento em português para data acadêmica', () => {
    expect(extractMoodleDeadline('Vencimento: terça-feira, 15 set. 2026, 23:59')).toBe(
      '2026-09-15T23:59:00',
    );
    expect(extractMoodleDeadline('Fechar: 3 out. 2026, 08:05')).toBe('2026-10-03T08:05:00');
  });

  it('mantém link, status e prazo da atividade', () => {
    expect(
      parseMoodleActivity({
        courseTitle: 'Empreendedorismo e Negócios',
        title: 'Atividade Online Pontuada 02',
        url: 'https://saladeaula.ead.uvv.br/mod/assign/view.php?id=20825',
        text: 'Atividade Online Pontuada 02 Vencimento: terça-feira, 15 set. 2026, 23:59',
        completion: 'Pendente',
      }),
    ).toMatchObject({
      externalId: 'ead:/mod/assign/view.php:20825',
      type: 'ASSIGNMENT',
      officialDeadline: '2026-09-15T23:59:00',
      status: 'Pendente',
    });
  });

  it('mantém materiais e atividades concluídas apenas como contexto', () => {
    expect(
      parseMoodleActivity({
        courseTitle: 'Governança em TI',
        title: 'Material da unidade 1',
        url: 'https://saladeaula.ead.uvv.br/mod/resource/view.php?id=10',
        text: 'Material da unidade 1',
        completion: '',
      })?.metadata.contextOnly,
    ).toBe('true');
    expect(
      parseMoodleActivity({
        courseTitle: 'Governança em TI',
        title: 'Atividade 1',
        url: 'https://saladeaula.ead.uvv.br/mod/quiz/view.php?id=11',
        text: 'Atividade 1',
        completion: 'Concluído',
      })?.metadata.contextOnly,
    ).toBe('true');
  });

  it('não transforma exercício de fixação não pontuado em pendência', () => {
    expect(
      parseMoodleActivity({
        courseTitle: 'Aspectos Legais',
        title: 'Atividade 1.1 - Exercício de Fixação',
        url: 'https://saladeaula.ead.uvv.br/mod/quiz/view.php?id=8614',
        text: 'Atividade 1.1 - Exercício de Fixação Questionário',
        completion: 'Marcar como feito',
      })?.metadata,
    ).toMatchObject({ contextOnly: 'true', graded: 'false' });
  });
});
