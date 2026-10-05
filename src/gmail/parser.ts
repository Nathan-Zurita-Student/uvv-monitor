import type { GmailHeader, GmailPart, GmailRawMessage, ParsedGmailMessage } from './types.js';

function decodeBase64Url(value: string): string {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function header(headers: GmailHeader[] | undefined, name: string): string {
  return headers?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

type Decoder = (data: string) => string;

function walkParts(
  part: GmailPart,
  texts: string[],
  attachments: ParsedGmailMessage['attachments'],
  decode: Decoder,
): void {
  if (part.filename) {
    attachments.push({
      filename: part.filename,
      mimeType: part.mimeType ?? 'application/octet-stream',
      ...(part.body?.attachmentId ? { attachmentId: part.body.attachmentId } : {}),
      ...(part.body?.size !== undefined ? { size: part.body.size } : {}),
    });
  }
  if (part.body?.data && (part.mimeType === 'text/plain' || part.mimeType === 'text/html')) {
    const decoded = decode(part.body.data);
    texts.push(part.mimeType === 'text/html' ? htmlToText(decoded) : decoded);
  }
  for (const child of part.parts ?? []) walkParts(child, texts, attachments, decode);
}

/** `decode` troca o Buffer do Node pelo decodificador do Apps Script. */
export function parseGmailMessage(
  message: GmailRawMessage,
  decode: Decoder = decodeBase64Url,
): ParsedGmailMessage {
  const texts: string[] = [];
  const attachments: ParsedGmailMessage['attachments'] = [];
  if (message.payload) walkParts(message.payload, texts, attachments, decode);
  const headers = message.payload?.headers;
  const body = texts
    .join('\n')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const links = Array.from(new Set(body.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? []));
  return {
    messageId: message.id,
    threadId: message.threadId,
    from: header(headers, 'From'),
    subject: header(headers, 'Subject'),
    date: header(headers, 'Date') || new Date(Number(message.internalDate ?? 0)).toISOString(),
    body,
    links,
    attachments,
  };
}
