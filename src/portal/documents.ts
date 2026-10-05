import { inflateRawSync } from 'node:zlib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PortalDocument } from '../models/portal-document.js';

/** Texto guardado por arquivo (uma célula da planilha aceita 50 mil caracteres). */
export const MAX_DOCUMENT_TEXT = 40_000;
const MAX_PDF_PAGES = 80;
/** Arquivos lidos dentro de um .zip. */
const MAX_ZIP_FILES = 12;

function tidy(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function extractPdfText(bytes: Uint8Array): Promise<{ pages: number; text: string }> {
  // verbosity 0: sem avisos de fonte no log (o texto sai igual).
  // Uma cópia: o pdfjs transfere (desliga) o buffer recebido, e o original ainda vai ser enviado
  // no Telegram.
  const document = await getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  const parts: string[] = [];
  let length = 0;
  try {
    const pages = Math.min(document.numPages, MAX_PDF_PAGES);
    for (let pageNumber = 1; pageNumber <= pages && length < MAX_DOCUMENT_TEXT; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((entry) => ('str' in entry ? `${entry.str}${entry.hasEOL ? '\n' : ' '}` : ''))
        .join('');
      parts.push(text);
      length += text.length;
    }
    return { pages: document.numPages, text: tidy(parts.join('\n\n')).slice(0, MAX_DOCUMENT_TEXT) };
  } finally {
    await document.destroy();
  }
}

/** Arquivos de um ZIP (DOCX, PPTX ou .zip comum) cujos nomes passam no filtro. */
export function unzipEntries(
  bytes: Uint8Array,
  wanted: (name: string) => boolean,
): Map<string, Buffer> {
  const buffer = Buffer.from(bytes);
  const files = new Map<string, Buffer>();
  // Fim do diretório central: assinatura 0x06054b50 nos últimos 64 KB.
  let end = -1;
  for (
    let offset = buffer.length - 22;
    offset >= Math.max(0, buffer.length - 65_557);
    offset -= 1
  ) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      end = offset;
      break;
    }
  }
  if (end < 0) return files;
  const count = buffer.readUInt16LE(end + 10);
  let pointer = buffer.readUInt32LE(end + 16);
  for (let index = 0; index < count && pointer + 46 <= buffer.length; index += 1) {
    if (buffer.readUInt32LE(pointer) !== 0x02014b50) break;
    const flags = buffer.readUInt16LE(pointer + 8);
    const method = buffer.readUInt16LE(pointer + 10);
    const compressedSize = buffer.readUInt32LE(pointer + 20);
    const nameLength = buffer.readUInt16LE(pointer + 28);
    const extraLength = buffer.readUInt16LE(pointer + 30);
    const commentLength = buffer.readUInt16LE(pointer + 32);
    const localHeader = buffer.readUInt32LE(pointer + 42);
    // Bit 11: nome em UTF-8; senão, CP437 (aproximado por latin1).
    const name = buffer.toString(
      flags & 0x800 ? 'utf8' : 'latin1',
      pointer + 46,
      pointer + 46 + nameLength,
    );
    pointer += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/') || !wanted(name) || localHeader + 30 > buffer.length) continue;
    if (buffer.readUInt32LE(localHeader) !== 0x04034b50) continue;
    const dataStart =
      localHeader +
      30 +
      buffer.readUInt16LE(localHeader + 26) +
      buffer.readUInt16LE(localHeader + 28);
    const data = buffer.subarray(dataStart, dataStart + compressedSize);
    try {
      const content = method === 8 ? inflateRawSync(data) : method === 0 ? data : undefined;
      if (content) files.set(name, content);
    } catch {
      // Entrada corrompida ou criptografada: segue com as outras.
    }
  }
  return files;
}

function xmlText(xml: string): string {
  return xml
    .replace(/<\/(w:p|a:p)>/g, '\n')
    .replace(/<w:tab\/>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export function extractOfficeText(
  bytes: Uint8Array,
  fileName: string,
): { pages: number; text: string } {
  if (/\.docx$/i.test(fileName)) {
    const files = unzipEntries(bytes, (name) => name === 'word/document.xml');
    const xml = files.get('word/document.xml')?.toString('utf8') ?? '';
    return { pages: 0, text: tidy(xmlText(xml)).slice(0, MAX_DOCUMENT_TEXT) };
  }
  const files = unzipEntries(bytes, (name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  const slides = [...files.entries()].sort(
    (left, right) =>
      Number(/(\d+)\.xml$/.exec(left[0])?.[1] ?? 0) -
      Number(/(\d+)\.xml$/.exec(right[0])?.[1] ?? 0),
  );
  const text = slides
    .map(([, xml], index) => `Slide ${String(index + 1)}\n${xmlText(xml.toString('utf8'))}`)
    .join('\n\n');
  return { pages: slides.length, text: tidy(text).slice(0, MAX_DOCUMENT_TEXT) };
}

export type DocumentKind = 'pdf' | 'office' | 'zip' | 'text' | 'image' | 'other';

const textExtensions =
  /\.(txt|md|csv|json|xml|html?|css|js|jsx|ts|tsx|java|py|c|cpp|h|cs|sql|kt|dart|php|rb|go|yaml|yml)$/i;

export function documentKind(fileName: string, contentType = ''): DocumentKind {
  if (/\.(png|jpe?g|gif|bmp|webp|heic)$/i.test(fileName) || /^image\//i.test(contentType))
    return 'image';
  if (/\.pdf$/i.test(fileName) || /pdf/i.test(contentType)) return 'pdf';
  if (/\.(docx|pptx)$/i.test(fileName)) return 'office';
  if (/\.zip$/i.test(fileName) || /zip/i.test(contentType)) return 'zip';
  if (textExtensions.test(fileName) || /^text\//i.test(contentType)) return 'text';
  return 'other';
}

async function readSingle(
  bytes: Uint8Array,
  fileName: string,
  contentType: string,
): Promise<{ pages: number; text: string } | undefined> {
  const kind = documentKind(fileName, contentType);
  if (kind === 'pdf') return extractPdfText(bytes);
  if (kind === 'office') return extractOfficeText(bytes, fileName);
  if (kind === 'text') {
    return {
      pages: 0,
      text: tidy(Buffer.from(bytes).toString('utf8')).slice(0, MAX_DOCUMENT_TEXT),
    };
  }
  return undefined;
}

/** Lê os PDFs, documentos e textos de dentro de um .zip (sem pastas do macOS e afins). */
async function readZip(
  bytes: Uint8Array,
): Promise<{ pages: number; text: string; files: string[] }> {
  const entries = unzipEntries(
    bytes,
    (name) =>
      !/(^|\/)(__MACOSX|\.)/.test(name) &&
      ['pdf', 'office', 'text'].includes(documentKind(name)) &&
      !/node_modules\//.test(name),
  );
  const parts: string[] = [];
  const files: string[] = [];
  let pages = 0;
  let length = 0;
  for (const [name, content] of [...entries.entries()].slice(0, MAX_ZIP_FILES)) {
    if (length >= MAX_DOCUMENT_TEXT) break;
    try {
      const read = await readSingle(new Uint8Array(content), name, '');
      if (!read?.text) continue;
      files.push(name);
      pages += read.pages;
      parts.push(`### ${name}\n${read.text}`);
      length += read.text.length;
    } catch {
      // Arquivo interno ilegível: segue com os outros.
    }
  }
  return { pages, text: parts.join('\n\n').slice(0, MAX_DOCUMENT_TEXT), files };
}

export async function readDocument(
  bytes: Uint8Array,
  fileName: string,
  contentType: string,
): Promise<Pick<PortalDocument, 'pages' | 'text' | 'status'>> {
  const kind = documentKind(fileName, contentType);
  if (kind === 'zip') {
    const { pages, text, files } = await readZip(bytes);
    return files.length > 0
      ? { pages, text, status: 'lido' }
      : { pages: 0, text: '', status: 'zip sem documentos legíveis' };
  }
  const read = await readSingle(bytes, fileName, contentType);
  if (!read)
    return { pages: 0, text: '', status: kind === 'image' ? 'imagem' : 'formato não lido' };
  // PDF escaneado (só imagem) não tem texto extraível.
  if (read.text.length < 30) return { ...read, status: 'sem texto (imagem)' };
  return { ...read, status: 'lido' };
}
