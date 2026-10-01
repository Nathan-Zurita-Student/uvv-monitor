import { z } from 'zod';
import type { ItemType } from '../models/academic-item.js';
import type { ClassCardInput, ClassPostPageInput, MessageLinkInput, PortalItem } from './models.js';

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

const monthNumbers: Record<string, number> = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};

function isoDate(year: number, month: number, day: number): string | undefined {
  const value = new Date(Date.UTC(year, month - 1, day));
  if (
    value.getUTCFullYear() !== year ||
    value.getUTCMonth() !== month - 1 ||
    value.getUTCDate() !== day
  ) {
    return undefined;
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function extractPortalDates(
  text: string,
  type: ItemType,
  referenceYear: number,
): { officialDate?: string; officialDeadline?: string } {
  const normalized = clean(text)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
  const deadline =
    /prazo\s+para\s+entrega\s*:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/i.exec(
      normalized,
    );
  if (deadline) {
    const date = isoDate(Number(deadline[3]), Number(deadline[2]), Number(deadline[1]));
    if (date) {
      return {
        officialDeadline:
          deadline[4] && deadline[5]
            ? `${date}T${deadline[4].padStart(2, '0')}:${deadline[5]}:00`
            : date,
      };
    }
  }

  if (['ASSIGNMENT', 'AOP', 'ACTIVITY', 'DOCUMENT'].includes(type)) {
    const taskDate =
      /(?:prazo|entrega|entregar|apresentacao|apresentar|atividade|trabalho)[^.!?]{0,180}?(?:dia\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?:\s+(?:as\s+)?(\d{1,2}):(\d{2}))?/i.exec(
        normalized,
      );
    if (taskDate) {
      const rawYear = Number(taskDate[3] ?? referenceYear);
      const year = rawYear < 100 ? 2000 + rawYear : rawYear;
      const date = isoDate(year, Number(taskDate[2]), Number(taskDate[1]));
      if (date) {
        return {
          officialDeadline:
            taskDate[4] && taskDate[5]
              ? `${date}T${taskDate[4].padStart(2, '0')}:${taskDate[5]}:00`
              : date,
        };
      }
    }
  }

  if (type === 'EXAM') {
    const writtenDate =
      /(?:prova|avaliacao|exame)[^.!?]{0,160}?(?:dia\s+)?(\d{1,2})\s+de\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+de\s+(\d{4}))?/i.exec(
        normalized,
      );
    if (writtenDate) {
      const date = isoDate(
        Number(writtenDate[3] ?? referenceYear),
        monthNumbers[writtenDate[2] ?? ''] ?? 0,
        Number(writtenDate[1]),
      );
      if (date) return { officialDate: date };
    }
    const numericDate =
      /(?:prova|avaliacao|exame)[^.!?]{0,120}?(?:dia\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/i.exec(
        normalized,
      );
    if (numericDate) {
      const rawYear = Number(numericDate[3] ?? referenceYear);
      const year = rawYear < 100 ? 2000 + rawYear : rawYear;
      const date = isoDate(year, Number(numericDate[2]), Number(numericDate[1]));
      if (date) return { officialDate: date };
    }
  }
  return {};
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

export function parseClassPostPage(input: ClassPostPageInput): PortalItem {
  const match = /\/Aluno\/Post\/([^/?#]+)/i.exec(input.url);
  if (!match?.[1]) throw new Error(`Link de post inválido: ${input.url}`);
  const headings = input.headings.map((heading) => clean(heading)).filter(Boolean);
  const originalTitle = headings.find((heading) => heading.toLowerCase() !== 'uvv avisa') ?? 'Post';
  const body = clean(input.bodyText);
  const type = inferItemType(`${originalTitle} ${body}`);
  const dates = extractPortalDates(
    `${headings.join(' ')} ${body} ${input.pageText}`,
    type,
    input.referenceYear,
  );
  const titleIndex = headings.indexOf(originalTitle);
  const professor = titleIndex >= 0 ? headings[titleIndex + 1] : undefined;
  const discipline = clean(input.discipline)
    .replace(
      professor ? new RegExp(`${professor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i') : /$^/,
      '',
    )
    .replace(/\s+Acessar(?:\s+ambiente\s+virtual)?\s*$/i, '')
    .trim();
  const title =
    type === 'EXAM' && /roteiro|orienta|estudo/i.test(originalTitle)
      ? `Prova — ${discipline.replace(/^\S+\s+-\s+/, '')}`
      : originalTitle;
  return {
    externalId: `post:${match[1]}`,
    origin: 'CLASS_POST',
    sourceUrl: input.url,
    discipline,
    title,
    description: body || originalTitle,
    type,
    ...dates,
    ...(professor ? { professor } : {}),
    links: [input.url, ...input.links.map((link) => link.href)],
    metadata: {
      portalPostId: match[1],
      originalTitle,
      ...(professor ? { professor } : {}),
      relatedLinks: JSON.stringify(input.links),
    },
  };
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
