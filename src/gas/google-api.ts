import { zonedInstant } from '../assistant/dates.js';
import type { CalendarPort, GmailPort } from '../assistant/tools.js';
import type {
  CalendarEvent,
  CalendarEventInput,
  CalendarEventPatch,
  EmailMessage,
  EmailSummary,
} from '../assistant/types.js';
import { htmlToText, parseGmailMessage } from '../gmail/parser.js';
import type { GmailRawMessage } from '../gmail/types.js';

const TOKEN_KEY = 'google.access-token';
const LEGACY_TOKEN_KEY = 'conversation.calendar-token';

/**
 * Token de acesso do Google com a autorização que o monitor já recebeu (Gmail somente leitura,
 * Agenda e Planilhas), sem pedir novos escopos ao Apps Script.
 */
export function googleAccessToken(): string {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(TOKEN_KEY);
  if (cached) return cached;
  const props = PropertiesService.getScriptProperties();
  const clientId = props.getProperty('GOOGLE_CLIENT_ID');
  const clientSecret = props.getProperty('GOOGLE_CLIENT_SECRET');
  const refreshToken = props.getProperty('GOOGLE_REFRESH_TOKEN');
  if (!clientId || !clientSecret || !refreshToken)
    throw new Error(
      'A agenda precisa da configuração Google do monitor. Execute a ação “Configurar conversa do Telegram” no GitHub.',
    );
  const body = {
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  };
  const response = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: Object.entries(body)
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join('&'),
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() !== 200)
    throw new Error('A autorização Google expirou ou foi recusada.');
  const token = JSON.parse(response.getContentText()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!token.access_token || !Number.isFinite(token.expires_in) || token.expires_in! < 120)
    throw new Error('Não consegui autorizar o acesso ao Google agora.');
  cache.put(TOKEN_KEY, token.access_token, Math.min(3300, token.expires_in! - 60));
  return token.access_token;
}

export function forgetGoogleToken(): void {
  CacheService.getScriptCache().removeAll([TOKEN_KEY, LEGACY_TOKEN_KEY]);
}

type FetchParams = Parameters<typeof UrlFetchApp.fetch>[1];

function request(
  method: 'get' | 'post' | 'patch' | 'delete',
  url: string,
  body?: unknown,
): FetchParams {
  return {
    method,
    headers: { authorization: `Bearer ${googleAccessToken()}` },
    muteHttpExceptions: true,
    ...(body !== undefined
      ? { contentType: 'application/json', payload: JSON.stringify(body) }
      : {}),
  };
}

function call<T>(
  method: 'get' | 'post' | 'patch' | 'delete',
  url: string,
  body?: unknown,
): { status: number; data: T } {
  const response = UrlFetchApp.fetch(url, request(method, url, body));
  const status = response.getResponseCode();
  const text = response.getContentText();
  return { status, data: (text ? JSON.parse(text) : {}) as T };
}

interface RawEvent {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  recurringEventId?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  extendedProperties?: { private?: Record<string, string> };
}

function eventFromApi(raw: RawEvent): CalendarEvent | undefined {
  if (!raw.id || raw.status === 'cancelled' || !raw.start || !raw.end) return undefined;
  const allDay = Boolean(raw.start.date && !raw.start.dateTime);
  const start = raw.start.dateTime
    ? new Date(raw.start.dateTime)
    : zonedInstant(raw.start.date ?? '');
  const end = raw.end.dateTime ? new Date(raw.end.dateTime) : zonedInstant(raw.end.date ?? '');
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return undefined;
  const props = raw.extendedProperties?.private ?? {};
  return {
    id: raw.id,
    title: raw.summary?.trim() || '(sem título)',
    start,
    end,
    allDay,
    ...(raw.description ? { description: raw.description.slice(0, 500) } : {}),
    ...(raw.location ? { location: raw.location } : {}),
    ...(props.uvvItemId ? { academicItemId: props.uvvItemId } : {}),
    ...(props.uvvAssistant ? { createdByAssistant: true } : {}),
    ...(raw.recurringEventId ? { recurring: true } : {}),
  };
}

const LIST_CACHE_SECONDS = 300;

/** Google Agenda pela API REST, com cache curto das consultas. */
export class GasCalendar implements CalendarPort {
  private readonly base: string;

  constructor(calendarId = 'primary') {
    this.base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  }

  private version(): string {
    return CacheService.getScriptCache().get('calendar.version') ?? '0';
  }

  private touch(): void {
    CacheService.getScriptCache().put('calendar.version', String(Date.now()), 21_600);
  }

  list(start: Date, end: Date): CalendarEvent[] {
    const cache = CacheService.getScriptCache();
    const key = `calendar.list.${this.version()}.${String(start.getTime())}.${String(end.getTime())}`;
    const cached = cache.get(key);
    if (cached) {
      return (JSON.parse(cached) as Array<CalendarEvent & { start: string; end: string }>).map(
        (event) => ({
          ...event,
          start: new Date(event.start),
          end: new Date(event.end),
        }),
      );
    }
    const params = [
      `timeMin=${encodeURIComponent(start.toISOString())}`,
      `timeMax=${encodeURIComponent(end.toISOString())}`,
      'singleEvents=true',
      'orderBy=startTime',
      'maxResults=250',
    ].join('&');
    const { status, data } = call<{ items?: RawEvent[] }>('get', `${this.base}?${params}`);
    if (status >= 400) throw new Error(`A Agenda respondeu HTTP ${String(status)}.`);
    const events = (data.items ?? []).flatMap((raw) => eventFromApi(raw) ?? []);
    const serialized = JSON.stringify(events);
    if (serialized.length < 90_000) cache.put(key, serialized, LIST_CACHE_SECONDS);
    return events;
  }

  get(id: string): CalendarEvent | undefined {
    const { status, data } = call<RawEvent>('get', `${this.base}/${encodeURIComponent(id)}`);
    if (status === 404 || status === 410) return undefined;
    if (status >= 400) throw new Error(`A Agenda respondeu HTTP ${String(status)}.`);
    return eventFromApi(data);
  }

  create(input: CalendarEventInput): CalendarEvent {
    const { status, data } = call<RawEvent>('post', this.base, {
      summary: input.title,
      ...(input.description
        ? { description: `${input.description}\n\nCriado pelo assistente da UVV no Telegram.` }
        : { description: 'Criado pelo assistente da UVV no Telegram.' }),
      start: { dateTime: input.start.toISOString(), timeZone: 'America/Sao_Paulo' },
      end: { dateTime: input.end.toISOString(), timeZone: 'America/Sao_Paulo' },
      ...(input.colorId ? { colorId: input.colorId } : {}),
      reminders: {
        useDefault: false,
        overrides: input.popupMinutes.map((minutes) => ({ method: 'popup', minutes })),
      },
      extendedProperties: {
        private: {
          uvvAssistant: '1',
          // Prova/entrega ligada a um item: o monitor reconhece o evento e não cria outro.
          ...(input.relatedItemId ? { uvvItemId: input.relatedItemId } : {}),
        },
      },
    });
    if (status >= 400 || !data.id)
      throw new Error(`A Agenda recusou a criação (HTTP ${String(status)}).`);
    this.touch();
    return (
      eventFromApi(data) ?? {
        id: data.id,
        title: input.title,
        start: input.start,
        end: input.end,
        allDay: false,
      }
    );
  }

  update(id: string, patch: CalendarEventPatch): CalendarEvent {
    const { status, data } = call<RawEvent>('patch', `${this.base}/${encodeURIComponent(id)}`, {
      ...(patch.title ? { summary: patch.title } : {}),
      ...(patch.description ? { description: patch.description } : {}),
      ...(patch.start
        ? { start: { dateTime: patch.start.toISOString(), timeZone: 'America/Sao_Paulo' } }
        : {}),
      ...(patch.end
        ? { end: { dateTime: patch.end.toISOString(), timeZone: 'America/Sao_Paulo' } }
        : {}),
    });
    if (status >= 400) throw new Error(`A Agenda recusou a alteração (HTTP ${String(status)}).`);
    this.touch();
    const event = eventFromApi(data);
    if (!event) throw new Error('A Agenda não devolveu o evento alterado.');
    return event;
  }

  remove(id: string): void {
    const { status } = call<unknown>('delete', `${this.base}/${encodeURIComponent(id)}`);
    if (status >= 400 && status !== 404 && status !== 410)
      throw new Error(`A Agenda recusou a remoção (HTTP ${String(status)}).`);
    this.touch();
  }
}

function decodeWebSafe(data: string): string {
  return Utilities.newBlob(Utilities.base64DecodeWebSafe(data)).getDataAsString('UTF-8');
}

function decodeEntities(text: string): string {
  return htmlToText(text)
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
}

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';

/** Gmail (somente leitura) pela API REST. */
export class GasGmail implements GmailPort {
  search(query: string, max: number): EmailSummary[] {
    const { status, data } = call<{ messages?: Array<{ id: string }> }>(
      'get',
      `${GMAIL}?q=${encodeURIComponent(query)}&maxResults=${String(max)}`,
    );
    if (status >= 400) throw new Error(`O Gmail respondeu HTTP ${String(status)}.`);
    const ids = (data.messages ?? []).map((message) => message.id).slice(0, max);
    if (ids.length === 0) return [];
    const headers = ['From', 'Subject', 'Date'].map((name) => `metadataHeaders=${name}`).join('&');
    const responses = UrlFetchApp.fetchAll(
      ids.map((id) => ({
        url: `${GMAIL}/${id}?format=metadata&${headers}`,
        ...request('get', ''),
      })),
    );
    return responses.flatMap((response, index) => {
      if (response.getResponseCode() >= 400) return [];
      const message = JSON.parse(response.getContentText()) as {
        snippet?: string;
        payload?: { headers?: Array<{ name: string; value: string }> };
      };
      const header = (name: string) =>
        message.payload?.headers?.find((entry) => entry.name.toLowerCase() === name.toLowerCase())
          ?.value ?? '';
      return [
        {
          id: ids[index]!,
          from: header('From'),
          subject: header('Subject') || '(sem assunto)',
          date: header('Date'),
          snippet: decodeEntities(message.snippet ?? ''),
        },
      ];
    });
  }

  read(id: string): EmailMessage {
    const { status, data } = call<GmailRawMessage & { snippet?: string }>(
      'get',
      `${GMAIL}/${encodeURIComponent(id)}?format=full`,
    );
    if (status >= 400) throw new Error(`O Gmail respondeu HTTP ${String(status)}.`);
    const parsed = parseGmailMessage(data, decodeWebSafe);
    return {
      id,
      from: parsed.from,
      subject: parsed.subject || '(sem assunto)',
      date: parsed.date,
      snippet: decodeEntities(data.snippet ?? ''),
      body: parsed.body,
      attachments: parsed.attachments.map((attachment) => attachment.filename),
    };
  }
}
