/**
 * Arquivo anexado a um post do professor no Portal (PDF, DOCX, PPTX, ZIP, imagem...). O monitor
 * baixa e envia no Telegram, guardando o file_id para reenviar. O conteúdo não é lido.
 * Sem dependências do Node: o bot no Apps Script lê a mesma aba.
 */
export interface PortalDocument {
  /** "doc:<aId do Portal>". */
  id: string;
  /** externalId do post ("post:..."). */
  postExternalId: string;
  discipline: string;
  postTitle: string;
  /** Dia da publicação do post (YYYY-MM-DD), quando conhecido. */
  publishedOn: string;
  fileName: string;
  url: string;
  contentType: string;
  sizeBytes: number;
  /** SHA-256 do conteúdo: o mesmo arquivo postado em vários posts é enviado uma vez só. */
  sha256: string;
  /** Sempre 0 (coluna mantida para as linhas já gravadas). */
  pages: number;
  /** "baixado", "grande demais" ou "erro: ...". */
  status: string;
  fetchedAt: string;
  /** file_id do Telegram depois do primeiro envio (permite reenviar sem baixar de novo). */
  telegramFileId: string;
  sentAt: string;
}

export const portalDocumentColumns = [
  'id',
  'postExternalId',
  'discipline',
  'postTitle',
  'publishedOn',
  'fileName',
  'url',
  'contentType',
  'sizeBytes',
  'sha256',
  'pages',
  'status',
  'fetchedAt',
  'telegramFileId',
  'sentAt',
] as const;

export function portalDocumentToRow(document: PortalDocument): string[] {
  return [
    document.id,
    document.postExternalId,
    document.discipline,
    document.postTitle,
    document.publishedOn,
    document.fileName,
    document.url,
    document.contentType,
    String(document.sizeBytes),
    document.sha256,
    String(document.pages),
    document.status,
    document.fetchedAt,
    document.telegramFileId,
    document.sentAt,
  ];
}

export function portalDocumentFromRow(row: string[]): PortalDocument | undefined {
  if (!row[0]) return undefined;
  return {
    id: row[0],
    postExternalId: row[1] ?? '',
    discipline: row[2] ?? '',
    postTitle: row[3] ?? '',
    publishedOn: row[4] ?? '',
    fileName: row[5] ?? '',
    url: row[6] ?? '',
    contentType: row[7] ?? '',
    sizeBytes: Number(row[8] ?? 0) || 0,
    sha256: row[9] ?? '',
    pages: Number(row[10] ?? 0) || 0,
    status: row[11] ?? '',
    fetchedAt: row[12] ?? '',
    telegramFileId: row[13] ?? '',
    sentAt: row[14] ?? '',
  };
}

export function documentIdFor(attachmentId: string): string {
  return `doc:${attachmentId}`;
}

/** Fotos são normalmente comprovantes enviados pelo aluno, não material didático do professor. */
export function isImageDocument(fileName: string, contentType = ''): boolean {
  return (
    contentType.toLowerCase().startsWith('image/') ||
    /\.(png|jpe?g|gif|webp|heic|bmp|tiff?)$/i.test(fileName)
  );
}

/** Ícone do tipo de arquivo, para listas no Telegram. */
export function fileIcon(fileName: string): string {
  if (/\.pdf$/i.test(fileName)) return '📕';
  if (/\.(docx?|odt|rtf)$/i.test(fileName)) return '📘';
  if (/\.(pptx?|odp)$/i.test(fileName)) return '📙';
  if (/\.(xlsx?|csv|ods)$/i.test(fileName)) return '📗';
  if (/\.(zip|rar|7z)$/i.test(fileName)) return '🗜️';
  if (/\.(png|jpe?g|gif|webp|heic|bmp)$/i.test(fileName)) return '🖼️';
  return '📄';
}
