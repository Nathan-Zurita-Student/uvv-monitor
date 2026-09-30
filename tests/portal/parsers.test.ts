import { describe, expect, it } from 'vitest';
import {
  inferItemType,
  parseCalendarResponse,
  parseClassCards,
  parseMessageLinks,
  parseWorkflowResponse,
} from '../../src/portal/parsers.js';

describe('parsers do Portal observados ao vivo', () => {
  it('extrai e deduplica IDs de mensagens', () => {
    const items = parseMessageLinks([
      {
        text: 'Comunicado de prova 16 set',
        href: 'https://aluno.uvv.br/Aluno/Mensagens/?mId=abc=',
      },
      { text: 'duplicada', href: 'https://aluno.uvv.br/Aluno/Mensagens/?mId=abc=' },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ externalId: 'message:abc=', type: 'EXAM' });
  });

  it('associa posts à disciplina e ignora placeholders null', () => {
    const items = parseClassCards([
      {
        heading: 'CC6N - Desenvolvimento de Games',
        text: 'Turma',
        links: [
          { text: 'null', href: 'https://aluno.uvv.br/Aluno/Post/placeholder=' },
          { text: 'Trabalho 1 Bim', href: 'https://aluno.uvv.br/Aluno/Post/post123=' },
        ],
      },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      externalId: 'post:post123=',
      discipline: 'CC6N - Desenvolvimento de Games',
      type: 'ASSIGNMENT',
    });
  });

  it('preserva a data oficial retornada pela API de calendário', () => {
    const items = parseCalendarResponse({
      Agenda: [
        {
          id: 859084,
          title: 'Atividade para entrega',
          subtitle: 'Desenvolvimento de Games\t',
          start: '2026-09-24T23:59:00',
          tipo: 1,
        },
      ],
    });
    expect(items[0]).toMatchObject({
      externalId: 'calendar:859084',
      officialDate: '2026-09-24T23:59:00',
      discipline: 'Desenvolvimento de Games',
    });
  });

  it('mapeia histórico oficial de atendimento', () => {
    const items = parseWorkflowResponse([
      {
        IdDocumento: 873364,
        EmissaoDocumento: '2026-09-29T17:30:27Z',
        NomeProcesso: 'Atendimento Eletrônico',
        Situacao: 'Aguardando Resposta',
        EstadoInicialExterno: 'Inicio',
        Comentarios: 0,
        TemComentarios: false,
      },
    ]);
    expect(items[0]).toMatchObject({
      externalId: 'service:873364',
      status: 'Aguardando Resposta',
      type: 'SERVICE_REQUEST',
    });
  });

  it.each([
    ['AOP 1', 'AOP'],
    ['Prova regular', 'EXAM'],
    ['Entrega do trabalho', 'ASSIGNMENT'],
    ['Mudança de horário', 'SCHEDULE_CHANGE'],
  ] as const)('classifica %s como %s', (title, expected) => {
    expect(inferItemType(title)).toBe(expected);
  });
});
