import { describe, expect, it } from 'vitest';
import { buildAcademicPrompt } from '../../src/ai/prompt.js';
import { analysisInputHash } from '../../src/ai/service.js';
import { decodeCallback, encodeCallback } from '../../src/bot/callbacks.js';
import { handleUpdate } from '../../src/bot/core.js';
import { createRenderContext } from '../../src/bot/screens.js';
import { renderView } from '../../src/bot/views.js';
import type { PortalDocument } from '../../src/models/portal-document.js';
import { deduplicateItems } from '../../src/persistence/deduplication.js';
import { item } from './fixtures.js';

const now = new Date('2026-10-05T18:00:00-03:00');

function file(overrides: Partial<PortalDocument>): PortalDocument {
  return {
    id: 'doc:U3',
    postExternalId: 'post:1',
    discipline: 'Cálculo Numérico Computacional',
    postTitle: 'Unidade 03',
    publishedOn: '2026-09-21',
    fileName: 'Unidade_03.pdf',
    url: 'x',
    contentType: 'application/pdf',
    sizeBytes: 1,
    sha256: 'a',
    pages: 57,
    status: 'lido',
    fetchedAt: now.toISOString(),
    telegramFileId: 'file-u3',
    sentAt: now.toISOString(),
    ...overrides,
  };
}

describe('📂 Materiais', () => {
  const materials = [
    file({}),
    file({
      id: 'doc:U2',
      fileName: 'Unidade_02.pdf',
      postTitle: 'Unidade 02',
      publishedOn: '2026-08-05',
      telegramFileId: 'file-u2',
    }),
    file({
      id: 'doc:M',
      discipline: 'CC6N - Desenvolvimento Mobile',
      fileName: 'useEffect.pdf',
      telegramFileId: 'file-m',
    }),
    file({ id: 'doc:pend', fileName: 'ainda.pdf', telegramFileId: '' }),
  ];
  const context = createRenderContext({ now, items: [], materials });

  it('lista as matérias e os arquivos recentes com botões para reenviar', () => {
    const view = renderView(context, 'files');
    expect(view.text).toContain('Materiais dos professores');
    expect(view.text).toContain('2 arquivos');
    expect(view.text).not.toContain('ainda.pdf');
    const buttons = view.keyboard.flat().map((button) => button.text);
    expect(buttons).toEqual(expect.arrayContaining(['📕 Unidade_03.pdf', '⬅️ Voltar']));
    expect(buttons.some((text) => text.startsWith('📚 Cálculo Numérico'))).toBe(true);
  });

  it('o botão da matéria reenvia os arquivos na ordem em que foram postados', () => {
    const action = decodeCallback(
      encodeCallback({ type: 'files', scope: 'discipline', key: 'calculo numerico computacional' }),
    );
    expect(action).toEqual({
      type: 'files',
      scope: 'discipline',
      key: 'calculo numerico computacional',
    });
    const effects = handleUpdate(
      {
        update_id: 1,
        callback_query: {
          id: 'cb',
          data: encodeCallback({
            type: 'files',
            scope: 'discipline',
            key: 'calculo numerico computacional',
          }),
          message: { message_id: 7, chat: { id: 42 } },
        },
      },
      { chatId: '42', context },
      now,
    );
    expect(effects).toContainEqual({
      type: 'sendFiles',
      files: [
        {
          fileId: 'file-u2',
          caption: '📚 <b>Cálculo Numérico Computacional</b>\nUnidade 02 · 05/08',
        },
        { fileId: 'file-u3', caption: 'Unidade 03 · 21/09' },
      ],
    });
    const [reply] = handleUpdate(
      { update_id: 2, message: { message_id: 1, chat: { id: 42 }, text: '/materiais' } },
      { chatId: '42', context },
      now,
    );
    expect(reply?.type).toBe('send');
    expect(reply && 'text' in reply ? reply.text : '').toContain('Materiais dos professores');
  });
});

describe('coleta: mudanças reais e anexos na análise', () => {
  it('changedAt só aparece quando o texto ou o prazo mudam', () => {
    const base = {
      externalId: 'post:1',
      source: 'PORTAL' as const,
      sourceUrl: 'x',
      title: 'Trabalho',
      description: 'Entregar dia 10/10',
      type: 'ASSIGNMENT' as const,
      status: 'TODO' as const,
      metadata: { origin: 'CLASS_POST' },
    };
    const [first] = deduplicateItems([base], [], '2026-10-01T00:00:00Z').newItems;
    const metadataOnly = deduplicateItems(
      [{ ...base, metadata: { origin: 'CLASS_POST', attachments: '[]' } }],
      [first!],
      '2026-10-02T00:00:00Z',
    ).changedItems[0]!;
    expect(metadataOnly.changes).toEqual([]);
    expect(metadataOnly.item.metadata?.changedAt).toBeUndefined();
    const edited = deduplicateItems(
      [{ ...base, description: 'Entregar dia 12/10' }],
      [first!],
      '2026-10-03T00:00:00Z',
    ).changedItems[0]!;
    expect(edited.item.metadata?.changedAt).toBe('2026-10-03T00:00:00Z');
    const later = deduplicateItems(
      [{ ...base, description: 'Entregar dia 12/10' }],
      [edited.item],
      '2026-10-04T00:00:00Z',
    ).unchangedItems[0]!;
    expect(later.metadata?.changedAt).toBe('2026-10-03T00:00:00Z');
  });

  it('a IA recebe o texto dos anexos, e sem anexos o hash não muda', () => {
    const post = item({ description: 'Segue o enunciado.' });
    const prompt = buildAcademicPrompt({
      item: post,
      maxInputCharacters: 20_000,
      attachments: [{ name: 'Trabalho_1B.pdf', text: 'Entrega até 14/10 em grupos de 4.' }],
    });
    expect(prompt).toContain('Arquivo anexado pelo professor: Trabalho_1B.pdf');
    expect(prompt).toContain('Entrega até 14/10');
    expect(analysisInputHash(post)).toBe(analysisInputHash(post, []));
    expect(analysisInputHash(post)).not.toBe(
      analysisInputHash(post, [{ name: 'a.pdf', text: 'novo' }]),
    );
  });
});
