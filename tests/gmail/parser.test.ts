import { describe, expect, it } from 'vitest';
import { parseGmailMessage } from '../../src/gmail/parser.js';
import { classifyGmailRelevance } from '../../src/gmail/relevance.js';

function encoded(value: string): string {
  return Buffer.from(value).toString('base64url');
}

describe('Gmail', () => {
  it('extrai cabeçalhos, texto, links e anexos MIME', () => {
    const parsed = parseGmailMessage({
      id: 'm1',
      threadId: 't1',
      payload: {
        mimeType: 'multipart/mixed',
        headers: [
          { name: 'From', value: 'Professor <docente@uvv.br>' },
          { name: 'Subject', value: 'Trabalho de Banco de Dados' },
          { name: 'Date', value: 'Wed, 30 Sep 2026 10:00:00 -0300' },
        ],
        parts: [
          { mimeType: 'text/plain', body: { data: encoded('Entregue em https://ava.uvv.br/aop') } },
          {
            mimeType: 'application/pdf',
            filename: 'orientacoes.pdf',
            body: { attachmentId: 'a1', size: 42 },
          },
        ],
      },
    });
    expect(parsed).toMatchObject({
      messageId: 'm1',
      from: 'Professor <docente@uvv.br>',
      links: ['https://ava.uvv.br/aop'],
      attachments: [{ filename: 'orientacoes.pdf', attachmentId: 'a1', size: 42 }],
    });
  });

  it('considera domínio e conteúdo, não apenas o domínio', () => {
    const result = classifyGmailRelevance({
      messageId: 'm1',
      threadId: 't1',
      from: 'Professor <pessoal@example.com>',
      subject: 'Prova da disciplina',
      date: '2026-09-30',
      body: 'Coordenação informa avaliação no portal do aluno.',
      links: [],
      attachments: [],
    });
    expect(result.relevant).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(3);
  });

  it('rejeita mensagem sem sinais acadêmicos suficientes', () => {
    expect(
      classifyGmailRelevance({
        messageId: 'm2',
        threadId: 't2',
        from: 'loja@example.com',
        subject: 'Promoção',
        date: '2026-09-30',
        body: 'Oferta válida hoje.',
        links: [],
        attachments: [],
      }).relevant,
    ).toBe(false);
  });
});
