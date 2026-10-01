import { google } from 'googleapis';
import type { GoogleCredentials } from '../config/env.js';
import { createGoogleOAuthClient } from '../google/auth.js';
import type {
  CalendarEventDate,
  CalendarEventInput,
  CalendarEventRecord,
  CalendarGateway,
} from './types.js';

function datePart(
  value:
    { date?: string | null; dateTime?: string | null; timeZone?: string | null } | null | undefined,
): CalendarEventDate {
  return {
    ...(value?.date ? { date: value.date } : {}),
    ...(value?.dateTime ? { dateTime: value.dateTime } : {}),
    ...(value?.timeZone ? { timeZone: value.timeZone } : {}),
  };
}

export class GoogleCalendarGateway implements CalendarGateway {
  private readonly calendar;

  constructor(
    credentials: GoogleCredentials,
    private readonly calendarId = 'primary',
  ) {
    this.calendar = google.calendar({ version: 'v3', auth: createGoogleOAuthClient(credentials) });
  }

  async list(timeMin: string, timeMax: string): Promise<CalendarEventRecord[]> {
    const response = await this.calendar.events.list({
      calendarId: this.calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      maxResults: 20,
    });
    return (response.data.items ?? []).flatMap((event) => {
      if (!event.id || !event.summary || !event.start || !event.end) return [];
      return [
        {
          id: event.id,
          summary: event.summary,
          description: event.description ?? '',
          start: datePart(event.start),
          end: datePart(event.end),
          extendedProperties: { private: event.extendedProperties?.private ?? {} },
        },
      ];
    });
  }

  async insert(event: CalendarEventInput): Promise<CalendarEventRecord> {
    const response = await this.calendar.events.insert({
      calendarId: this.calendarId,
      requestBody: event,
    });
    if (!response.data.id) throw new Error('Calendar não retornou o ID do evento criado.');
    return { ...event, id: response.data.id };
  }

  async update(eventId: string, event: CalendarEventInput): Promise<CalendarEventRecord> {
    const response = await this.calendar.events.update({
      calendarId: this.calendarId,
      eventId,
      requestBody: event,
    });
    return { ...event, id: response.data.id ?? eventId };
  }
}
