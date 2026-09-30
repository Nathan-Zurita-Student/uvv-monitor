import { createHash } from 'node:crypto';
import { normalizeText, stableStringify } from './normalize.js';

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export interface ContentHashInput {
  source: string;
  externalId: string;
  discipline?: string;
  title: string;
  description: string;
  type: string;
  officialDate?: string;
  officialDeadline?: string;
  status?: string;
  metadata?: Record<string, string>;
}

export function generateContentHash(input: ContentHashInput): string {
  return sha256(
    stableStringify({
      source: normalizeText(input.source),
      externalId: normalizeText(input.externalId),
      discipline: normalizeText(input.discipline ?? ''),
      title: normalizeText(input.title),
      description: normalizeText(input.description),
      type: input.type,
      officialDate: input.officialDate ?? '',
      officialDeadline: input.officialDeadline ?? '',
      status: normalizeText(input.status ?? ''),
      metadata: input.metadata ?? {},
    }),
  );
}

export function friendlyItemId(source: string, externalId: string): string {
  return `UVV-${sha256(`${source}:${externalId}`).slice(0, 6).toUpperCase()}`;
}
