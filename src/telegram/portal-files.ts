import type { PortalDocument } from '../models/portal-document.js';
import { logger } from '../utils/logger.js';
import type { OutgoingFile } from './client.js';
import { escapeHtml } from './html.js';

/** Arquivo baixado nesta coleta, com o conteúdo em memória para o upload. */
export interface DownloadedDocument extends PortalDocument {
  bytes?: Uint8Array;
}

export interface FileSender {
  sendFiles(files: OutgoingFile[], options?: { silent?: boolean }): Promise<string[]>;
  sendMessage(text: string, options?: { silent?: boolean }): Promise<unknown>;
}

/** Limite de upload de bots no Telegram (50 MB), com folga. */
const MAX_TELEGRAM_BYTES = 49 * 1024 * 1024;
/** Álbuns pequenos: um upload grande demais costuma cair ou estourar o tempo. */
const ALBUM_SIZE = 6;
const ALBUM_BYTES = 10 * 1024 * 1024;
/** Arquivos de posts desta semana chegam como novidade; os mais antigos, organizados por matéria. */
const FRESH_DAYS = 7;

export interface FileBatch {
  documents: DownloadedDocument[];
  captions: string[];
}

function dayMonth(date: string): string {
  return date ? `${date.slice(8, 10)}/${date.slice(5, 7)}` : '';
}

function discipline(document: PortalDocument): string {
  return document.discipline.replace(/^\S+\s+-\s+/, '') || 'Outras';
}

function isFresh(document: PortalDocument, now: Date): boolean {
  if (!document.publishedOn) return true;
  const published = Date.parse(`${document.publishedOn}T12:00:00-03:00`);
  return !Number.isFinite(published) || now.getTime() - published <= FRESH_DAYS * 86_400_000;
}

/** Agrupa em álbuns de até ALBUM_SIZE arquivos e ALBUM_BYTES no total (um arquivo grande vai só). */
function chunk(documents: DownloadedDocument[]): DownloadedDocument[][] {
  const result: DownloadedDocument[][] = [];
  let current: DownloadedDocument[] = [];
  let bytes = 0;
  for (const document of documents) {
    if (
      current.length > 0 &&
      (current.length >= ALBUM_SIZE || bytes + document.sizeBytes > ALBUM_BYTES)
    ) {
      result.push(current);
      current = [];
      bytes = 0;
    }
    current.push(document);
    bytes += document.sizeBytes;
  }
  if (current.length > 0) result.push(current);
  return result;
}

/**
 * Como os arquivos novos viram mensagens: os de posts recentes, um álbum por post; os antigos
 * (primeira coleta), álbuns por disciplina em ordem de publicação.
 */
export function planFileBatches(
  documents: DownloadedDocument[],
  now: Date,
): { backfill: FileBatch[]; fresh: FileBatch[] } {
  const backfill: FileBatch[] = [];
  const fresh: FileBatch[] = [];
  const old = documents.filter((document) => !isFresh(document, now));
  const byDiscipline = new Map<string, DownloadedDocument[]>();
  for (const document of old) {
    byDiscipline.set(discipline(document), [
      ...(byDiscipline.get(discipline(document)) ?? []),
      document,
    ]);
  }
  for (const [name, group] of [...byDiscipline.entries()].sort((left, right) =>
    left[0].localeCompare(right[0]),
  )) {
    const ordered = [...group].sort((left, right) =>
      left.publishedOn.localeCompare(right.publishedOn),
    );
    chunk(ordered).forEach((part, partIndex) => {
      backfill.push({
        documents: part,
        captions: part.map(
          (document, index) =>
            `${partIndex === 0 && index === 0 ? `📚 <b>${escapeHtml(name)}</b>\n` : ''}${escapeHtml(document.postTitle.slice(0, 200))}${document.publishedOn ? ` · ${dayMonth(document.publishedOn)}` : ''}`,
        ),
      });
    });
  }
  const byPost = new Map<string, DownloadedDocument[]>();
  for (const document of documents.filter((entry) => isFresh(entry, now))) {
    byPost.set(document.postExternalId, [...(byPost.get(document.postExternalId) ?? []), document]);
  }
  for (const group of byPost.values()) {
    const [first] = group as [DownloadedDocument];
    chunk(group).forEach((part, partIndex) => {
      fresh.push({
        documents: part,
        captions: part.map((_, index) =>
          partIndex === 0 && index === 0
            ? `📎 <b>Material novo · ${escapeHtml(discipline(first))}</b>\n${escapeHtml(first.postTitle.slice(0, 300))}`
            : '',
        ),
      });
    });
  }
  return { backfill, fresh };
}

/**
 * Envia no Telegram os arquivos baixados que ainda não foram enviados e devolve todos com o
 * file_id preenchido. O mesmo conteúdo (SHA-256) já enviado antes é só reaproveitado.
 */
export async function deliverPortalFiles(
  sender: FileSender,
  downloaded: DownloadedDocument[],
  previous: PortalDocument[],
  now: Date,
  options: { dryRun?: boolean; pause?: (ms: number) => Promise<void> } = {},
): Promise<{ documents: DownloadedDocument[]; sent: number; errors: string[] }> {
  const pause =
    options.pause ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const sentAt = now.toISOString();
  const bySha = new Map(
    previous
      .filter((document) => document.telegramFileId && document.sha256)
      .map((document) => [document.sha256, document.telegramFileId]),
  );
  const result = downloaded.map((document) => ({ ...document }));
  const toSend: DownloadedDocument[] = [];
  for (const document of result) {
    const known = document.sha256 ? bySha.get(document.sha256) : undefined;
    if (known) {
      document.telegramFileId = known;
      document.sentAt = sentAt;
      continue;
    }
    if (!document.bytes || document.sizeBytes > MAX_TELEGRAM_BYTES) continue;
    // Repetido dentro desta coleta: vai uma vez só.
    if (toSend.some((other) => other.sha256 && other.sha256 === document.sha256)) continue;
    toSend.push(document);
  }
  const errors: string[] = [];
  let sent = 0;
  if (toSend.length === 0 || options.dryRun) return { documents: result, sent, errors };

  const { backfill, fresh } = planFileBatches(toSend, now);
  if (backfill.length > 0) {
    const files = backfill.reduce((total, batch) => total + batch.documents.length, 0);
    const subjects = new Set(backfill.flatMap((batch) => batch.documents.map(discipline))).size;
    await sender.sendMessage(
      `📚 <b>Materiais das suas matérias</b>\n\nBaixei do Portal o que os professores já postaram: ${String(files)} ${files === 1 ? 'arquivo' : 'arquivos'} de ${String(subjects)} ${subjects === 1 ? 'matéria' : 'matérias'}, organizados abaixo.\n\nDaqui pra frente, cada arquivo novo chega aqui assim que aparecer no Portal. Para pedir de novo, use /materiais ou me peça na conversa.`,
    );
  }
  for (const [index, batch] of [...backfill, ...fresh].entries()) {
    if (index > 0) await pause(1_500);
    const silent = backfill.includes(batch) && index > 0;
    const record = (documents: DownloadedDocument[], ids: string[]) =>
      documents.forEach((document, position) => {
        const id = ids[position];
        if (!id) return;
        document.telegramFileId = id;
        document.sentAt = sentAt;
        if (document.sha256) bySha.set(document.sha256, id);
        sent += 1;
      });
    const outgoing = (document: DownloadedDocument, position: number): OutgoingFile => ({
      bytes: document.bytes!,
      fileName: document.fileName,
      contentType: document.contentType,
      ...(batch.captions[position] ? { caption: batch.captions[position] } : {}),
    });
    try {
      record(batch.documents, await sender.sendFiles(batch.documents.map(outgoing), { silent }));
    } catch (error) {
      logger.warn(
        { module: 'Telegram', error: error instanceof Error ? error.message : 'erro' },
        'Álbum não enviado; tentando arquivo por arquivo',
      );
      // Um por um: o que falhar de novo fica sem file_id e volta na próxima coleta.
      for (const [position, document] of batch.documents.entries()) {
        try {
          await pause(1_000);
          record([document], await sender.sendFiles([outgoing(document, position)], { silent }));
        } catch (single) {
          const message = single instanceof Error ? single.message : 'erro';
          errors.push(`Arquivo ${document.fileName}: ${message}`);
          logger.warn({ module: 'Telegram', error: message }, 'Envio de arquivo falhou');
        }
      }
    }
  }
  // Repetidos desta coleta recebem o file_id do primeiro envio.
  for (const document of result) {
    if (!document.telegramFileId && document.sha256 && bySha.has(document.sha256)) {
      document.telegramFileId = bySha.get(document.sha256)!;
      document.sentAt = sentAt;
    }
  }
  return { documents: result, sent, errors };
}
