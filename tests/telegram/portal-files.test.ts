import { describe, expect, it } from 'vitest';
import type { PortalDocument } from '../../src/models/portal-document.js';
import type { OutgoingFile } from '../../src/telegram/client.js';
import {
  deliverPortalFiles,
  planFileBatches,
  type DownloadedDocument,
} from '../../src/telegram/portal-files.js';

const now = new Date('2026-10-05T18:00:00-03:00');

function doc(overrides: Partial<DownloadedDocument>): DownloadedDocument {
  return {
    id: 'doc:1',
    postExternalId: 'post:1',
    discipline: 'Desenvolvimento Mobile',
    postTitle: 'Atividade Pontuada',
    publishedOn: '2026-10-04',
    fileName: 'atividade.pdf',
    url: 'https://aluno.uvv.br/Aluno/BaixarArquivoPost?aId=1',
    contentType: 'application/pdf',
    sizeBytes: 3,
    sha256: 'sha-1',
    pages: 1,
    status: 'lido',
    fetchedAt: now.toISOString(),
    telegramFileId: '',
    sentAt: '',
    bytes: new Uint8Array([1, 2, 3]),
    ...overrides,
  };
}

class FakeSender {
  readonly albums: OutgoingFile[][] = [];
  readonly messages: string[] = [];
  sendFiles(files: OutgoingFile[]): Promise<string[]> {
    this.albums.push(files);
    return Promise.resolve(files.map((file) => `file-${file.fileName}`));
  }
  sendMessage(text: string): Promise<unknown> {
    this.messages.push(text);
    return Promise.resolve({});
  }
}

const noPause = () => Promise.resolve();

describe('arquivos dos professores no Telegram', () => {
  it('organiza o histórico por matéria e os novos por post', () => {
    const plan = planFileBatches(
      [
        doc({
          id: 'doc:a',
          publishedOn: '2026-08-10',
          fileName: 'a.pdf',
          discipline: 'CC6N - Games',
        }),
        doc({
          id: 'doc:b',
          publishedOn: '2026-08-03',
          fileName: 'b.pdf',
          discipline: 'CC6N - Games',
        }),
        doc({
          id: 'doc:c',
          publishedOn: '2026-10-04',
          fileName: 'c.pdf',
          postExternalId: 'post:9',
        }),
      ],
      now,
    );
    expect(plan.backfill).toHaveLength(1);
    expect(plan.backfill[0]?.documents.map((document) => document.fileName)).toEqual([
      'b.pdf',
      'a.pdf',
    ]);
    expect(plan.backfill[0]?.captions[0]).toBe('📚 <b>Games</b>\nAtividade Pontuada · 03/08');
    expect(plan.fresh[0]?.captions[0]).toBe(
      '📎 <b>Material novo · Desenvolvimento Mobile</b>\nAtividade Pontuada',
    );
  });

  it('envia uma vez cada conteúdo e reaproveita o que já foi enviado', async () => {
    const sender = new FakeSender();
    const previous: PortalDocument[] = [
      { ...doc({ id: 'doc:old', sha256: 'sha-old' }), telegramFileId: 'file-antigo' },
    ];
    const result = await deliverPortalFiles(
      sender,
      [
        doc({ id: 'doc:1', sha256: 'sha-1', fileName: 'IMG_5330.png' }),
        doc({ id: 'doc:2', sha256: 'sha-1', fileName: 'IMG_5330.png', postExternalId: 'post:2' }),
        doc({ id: 'doc:3', sha256: 'sha-old', fileName: 'repetido.pdf' }),
        doc({ id: 'doc:4', sha256: 'sha-4', fileName: 'novo.pdf' }),
      ],
      previous,
      now,
      { pause: noPause },
    );
    const sentNames = sender.albums.flat().map((file) => file.fileName);
    expect(sentNames.sort()).toEqual(['IMG_5330.png', 'novo.pdf']);
    expect(Object.fromEntries(result.documents.map((d) => [d.id, d.telegramFileId]))).toEqual({
      'doc:1': 'file-IMG_5330.png',
      'doc:2': 'file-IMG_5330.png',
      'doc:3': 'file-antigo',
      'doc:4': 'file-novo.pdf',
    });
    expect(result.sent).toBe(2);
    // Posts desta semana: sem o cabeçalho do histórico.
    expect(sender.messages).toHaveLength(0);
  });

  it('no primeiro envio do histórico avisa antes e não envia nada em modo de teste', async () => {
    const sender = new FakeSender();
    await deliverPortalFiles(sender, [doc({ publishedOn: '2026-08-01' })], [], now, {
      pause: noPause,
    });
    expect(sender.messages[0]).toContain('Materiais das suas matérias');
    const dry = new FakeSender();
    const result = await deliverPortalFiles(dry, [doc({})], [], now, { dryRun: true });
    expect(dry.albums).toHaveLength(0);
    expect(result.documents[0]?.telegramFileId).toBe('');
  });
});
