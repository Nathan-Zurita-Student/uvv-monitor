export interface CalendarEventDate {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface CalendarEventInput {
  summary: string;
  description: string;
  start: CalendarEventDate;
  end: CalendarEventDate;
  extendedProperties: { private: Record<string, string> };
}

export interface CalendarEventRecord extends CalendarEventInput {
  id: string;
}

export interface CalendarGateway {
  list(timeMin: string, timeMax: string, itemId: string): Promise<CalendarEventRecord[]>;
  insert(event: CalendarEventInput): Promise<CalendarEventRecord>;
  update(eventId: string, event: CalendarEventInput): Promise<CalendarEventRecord>;
}
