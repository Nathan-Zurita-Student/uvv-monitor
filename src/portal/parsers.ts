import { z } from 'zod';
import type { ItemType } from '../models/academic-item.js';
import type { ClassCardInput, MessageLinkInput, PortalItem } from './models.js';

const portalBase = 'https://aluno.uvv.br';

const calendarEventSchema = z.object({
  id: z.union([z.number(), z.string()]),
  title: z.string(),
  subtitle: z.string().nullish(),
  start: z.string(),
  tipo: z.number(),
});

const calendarResponseSchema = z.object({
  Agenda: z.array(calendarEventSchema),
  DefaultDate: z.string().optional(),
});

const workflowEntrySchema = z.object({
  IdDocumento: z.union([z.number(), z.string()]),
  EmissaoDocumento: z.string(),
  NomeProcesso: z.string(),
  Situacao: z.string(),
  EstadoInicialExterno: z.string().nullish(),
  Comentarios: z.number().optional(),
  TemComentarios: z.boolean().optional(),
  IdDocumentoEncripto: z.string().optional(),
});

const workflowResponseSchema = z.array(workflowEntrySchema);

function clean(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

export function inferItemType(text: string): ItemType {
  const normalized = text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
  if (/\b(prova|avaliacao|exame)\b/.test(normalized)) return 'EXAM';
  if (/\baop\b/.test(normalized)) return 'AOP';
  if (/\b(trabalho|entrega|atividade)\b/.test(normalized)) return 'ASSIGNMENT';
  if (/\b(nota|resultado|feedback)\b/.test(normalized)) return 'GRADE';
  if (/\b(documento|declaracao)\b/.test(normalized)) return 'DOCUMENT';
  if (/\b(cancelad[ao]|reposicao|mudanca de horario|alteracao de horario)\b/.test(normalized)) {
    return 'SCHEDULE_CHANGE';
  }
  return 'NOTICE';
}

function extractId(url: string, parameter: string): string | undefined {
  try {
    return new URL(url).searchParams.get(parameter) ?? undefined;
  } catch {
    return undefined;
  }
}

export function parseMessageLinks(inputs: MessageLinkInput[]): PortalItem[] {
  const seen = new Set<string>();
  return inputs.flatMap((input) => {
    const externalId = extractId(input.href, 'mId');
    if (!externalId || seen.has(externalId)) return [];
    seen.add(externalId);
    const title = clean(input.text);
    return [
      {
        externalId: `message:${externalId}`,
        origin: 'MESSAGE' as const,
        sourceUrl: input.href,
        title,
        description: title,
        type: inferItemType(title),
        links: [input.href],
        metadata: { portalMessageId: externalId },
      },
    ];
  });
}

export function parseClassCards(inputs: ClassCardInput[]): PortalItem[] {
  const items: PortalItem[] = [];
  for (const card of inputs) {
    const discipline = clean(card.heading);
    for (const link of card.links) {
      const match = /\/Aluno\/Post\/([^/?#]+)/i.exec(link.href);
      if (!match?.[1] || clean(link.text).toLowerCase() === 'null') continue;
      const title = clean(link.text);
      items.push({
        externalId: `post:${match[1]}`,
        origin: 'CLASS_POST',
        sourceUrl: link.href,
        discipline,
        title,
        description: title,
        type: inferItemType(title),
        links: [link.href],
        metadata: { portalPostId: match[1], cardText: clean(card.text) },
      });
    }
  }
  return items;
}

export function parseCalendarResponse(payload: unknown): PortalItem[] {
  const response = calendarResponseSchema.parse(payload);
  return response.Agenda.map((event) => {
    const title = clean(event.title);
    const discipline = clean(event.subtitle);
    return {
      externalId: `calendar:${String(event.id)}`,
      origin: 'CALENDAR',
      sourceUrl: `${portalBase}/Calendario/Aluno/bM89MeSHNBc=`,
      ...(discipline ? { discipline } : {}),
      title,
      description: title,
      type: inferItemType(title),
      officialDate: event.start,
      links: [],
      metadata: { portalEventType: String(event.tipo) },
    };
  });
}

export function parseWorkflowResponse(payload: unknown): PortalItem[] {
  const response = workflowResponseSchema.parse(payload);
  return response.map((entry) => {
    const id = String(entry.IdDocumento);
    const state = clean(entry.EstadoInicialExterno);
    return {
      externalId: `service:${id}`,
      origin: 'SERVICE',
      sourceUrl: `${portalBase}/Atendimento/`,
      title: clean(entry.NomeProcesso),
      description: state || clean(entry.Situacao),
      type: 'SERVICE_REQUEST',
      publishedAt: entry.EmissaoDocumento,
      status: clean(entry.Situacao),
      links: [],
      metadata: {
        documentId: id,
        encryptedDocumentId: entry.IdDocumentoEncripto ?? '',
        state,
        comments: String(entry.Comentarios ?? 0),
        hasComments: String(entry.TemComentarios ?? false),
      },
    };
  });
}
