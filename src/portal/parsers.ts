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

/** Horários sempre ligados à data no texto oficial, inclusive DD/MM/AAAA:HH:mm da UVV. */
function dateWithTime(date: string, hours?: string, minutes?: string): string {
  if (!hours || !minutes || Number(hours) > 23 || Number(minutes) > 59) return date;
  return `${date}T${hours.padStart(2, '0')}:${minutes}:00`;
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
      if (date) {
        const after = normalized.slice((writtenDate.index ?? 0) + writtenDate[0].length);
        const time = /^\s*(?:,\s*)?(?:as|a partir das)\s+(\d{1,2})[:h](\d{2})/.exec(after);
        return { officialDate: dateWithTime(date, time?.[1], time?.[2]) };
      }
    }
    const numericDate =
      /(?:provas?|avaliacao|exame)[^.!?]{0,180}?(?:dia\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?:\s*(?::|,?\s+(?:as\s+|a partir das\s+)?)(\d{1,2})[:h](\d{2}))?/i.exec(
        normalized,
      );
    if (numericDate) {
      const rawYear = Number(numericDate[3] ?? referenceYear);
      const year = rawYear < 100 ? 2000 + rawYear : rawYear;
      const date = isoDate(year, Number(numericDate[2]), Number(numericDate[1]));
      if (date) return { officialDate: dateWithTime(date, numericDate[4], numericDate[5]) };
    }
  }
  return {};
}

export function parseMessageContent(
  summary: PortalItem,
  body: string,
  links: Array<{ text: string; href: string }>,
  referenceYear: number,
): PortalItem {
  if (!body.trim()) throw new Error('Conteúdo da mensagem do Portal não encontrado.');
  const type = inferItemType(`${summary.title} ${body}`);
  const location = /(?:no seguinte local|local da prova|local)\s*:?\s*(.+)/i
    .exec(body)?.[1]
    ?.trim();
  const scheduled = /prova\s+agendada/i.test(body);
  return {
    ...summary,
    description: body.trim(),
    type,
    ...extractPortalDates(body, type, referenceYear),
    links: [summary.sourceUrl, ...links.map((link) => link.href)],
    metadata: {
      ...summary.metadata,
      relatedLinks: JSON.stringify(links),
      ...(location ? { location } : {}),
      ...(scheduled ? { officialExamAppointment: 'true' } : {}),
    },
  };
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

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function htmlText(html: string): string {
  return clean(
    decodeEntities(
      html
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<br\s*\/?>|<\/p>|<\/li>/gi, '\n')
        .replace(/<[^>]+>/g, ' '),
    ),
  );
}

const monthAbbreviations = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];

export interface BlogTimelineEntry {
  postId: string;
  title: string;
  /** Dia da publicação (YYYY-MM-DD), quando o mural informa. */
  publishedOn?: string;
  text: string;
}

/**
 * Lê uma página do mural da turma (a página inicial ou o "Carregar mais…", que devolve o mesmo
 * HTML em partes). O mural mostra só dia e mês: o ano é o mais próximo de `now` sem ficar no futuro.
 */
export function parseBlogTimeline(html: string, now: Date): BlogTimelineEntry[] {
  const entries: BlogTimelineEntry[] = [];
  const seen = new Set<string>();
  const [yearText = '2000', monthText = '1', dayText = '1'] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(now)
    .split('-');
  const today = `${yearText}-${monthText}-${dayText}`;
  for (const block of html.split(/<li\b[^>]*class="[^"]*timeline[^"]*"[^>]*>/i).slice(1)) {
    const postId = /\/Aluno\/Post\/([^"'?#<\s]+)/i.exec(block)?.[1];
    if (!postId || seen.has(postId)) continue;
    seen.add(postId);
    const title = htmlText(/<h3[^>]*panel-title[^>]*>([\s\S]*?)<\/h3>/i.exec(block)?.[1] ?? '');
    const date = /timeline-date[^>]*>\s*(\d{1,2})\s*<p>\s*([a-zç]{3})/i.exec(block);
    let publishedOn: string | undefined;
    const month = date?.[2] ? monthAbbreviations.indexOf(date[2].toLowerCase()) + 1 : 0;
    if (date?.[1] && month > 0) {
      let year = Number(yearText);
      let candidate = isoDate(year, month, Number(date[1]));
      if (candidate && candidate > today) {
        year -= 1;
        candidate = isoDate(year, month, Number(date[1]));
      }
      publishedOn = candidate;
    }
    const body = /<div[^>]*class="panel-body"[^>]*>([\s\S]*?)<a[^>]*\/Aluno\/Post\//i.exec(block);
    entries.push({
      postId,
      title,
      ...(publishedOn ? { publishedOn } : {}),
      text: htmlText(body?.[1] ?? ''),
    });
  }
  return entries;
}

export interface PostAttachment {
  /** Identificador do arquivo no Portal (parâmetro aId). */
  id: string;
  name: string;
  url: string;
}

/** Botões "Baixar Arquivo" do post (/Aluno/BaixarArquivoPost?aId=...&pId=...). */
export function parsePostAttachments(
  links: Array<{ text: string; href: string }>,
): PostAttachment[] {
  const attachments: PostAttachment[] = [];
  for (const link of links) {
    let url: URL;
    try {
      url = new URL(link.href, portalBase);
    } catch {
      continue;
    }
    if (!/\/Aluno\/BaixarArquivoPost/i.test(url.pathname)) continue;
    const id = url.searchParams.get('aId');
    if (!id || attachments.some((attachment) => attachment.id === id)) continue;
    attachments.push({ id, name: clean(link.text) || 'arquivo', url: url.toString() });
  }
  return attachments;
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
  const attachments = parsePostAttachments(input.attachments ?? []);
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
    links: [
      input.url,
      ...input.links.map((link) => link.href),
      ...attachments.map((attachment) => attachment.url),
    ],
    metadata: {
      portalPostId: match[1],
      originalTitle,
      ...(professor ? { professor } : {}),
      relatedLinks: JSON.stringify(input.links),
      ...(attachments.length > 0 ? { attachments: JSON.stringify(attachments) } : {}),
      // Meio-dia local: o mural só informa o dia da publicação.
      ...(input.publishedOn ? { receivedAt: `${input.publishedOn}T12:00:00-03:00` } : {}),
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
