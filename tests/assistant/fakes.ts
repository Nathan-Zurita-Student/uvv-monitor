import type { AssistantDeps, CalendarPort, GmailPort } from '../../src/assistant/tools.js';
import type {
  CalendarEvent,
  CalendarEventInput,
  CalendarEventPatch,
  MemoryFact,
  PendingAction,
  PersonalReminder,
} from '../../src/assistant/types.js';
import type { AcademicItem, UserTaskStatus } from '../../src/models/academic-item.js';

/** Agenda em memória para os testes das ferramentas. */
export class FakeCalendar implements CalendarPort {
  readonly created: CalendarEventInput[] = [];
  readonly removed: string[] = [];
  readonly updated: Array<{ id: string; patch: CalendarEventPatch }> = [];
  lists = 0;

  constructor(public events: CalendarEvent[] = []) {}

  list(start: Date, end: Date): CalendarEvent[] {
    this.lists += 1;
    return this.events.filter(
      (event) => event.end.getTime() > start.getTime() && event.start.getTime() < end.getTime(),
    );
  }

  get(id: string): CalendarEvent | undefined {
    return this.events.find((event) => event.id === id);
  }

  create(input: CalendarEventInput): CalendarEvent {
    this.created.push(input);
    const event: CalendarEvent = {
      id: `evt-${String(this.created.length)}`,
      title: input.title,
      start: input.start,
      end: input.end,
      allDay: false,
      createdByAssistant: true,
      ...(input.relatedItemId ? { academicItemId: input.relatedItemId } : {}),
    };
    this.events.push(event);
    return event;
  }

  update(id: string, patch: CalendarEventPatch): CalendarEvent {
    this.updated.push({ id, patch });
    const event = this.get(id)!;
    Object.assign(event, patch);
    return event;
  }

  remove(id: string): void {
    this.removed.push(id);
    this.events = this.events.filter((event) => event.id !== id);
  }
}

export class FakeGmail implements GmailPort {
  queries: string[] = [];
  search(query: string) {
    this.queries.push(query);
    return [
      {
        id: 'msg123456',
        from: 'Prof. Saulo <saulo@uvv.br>',
        subject: 'Trabalho de Banco de Dados',
        date: 'Mon, 5 Oct 2026 10:00:00 -0300',
        snippet: 'A entrega mudou para o AVA.',
      },
    ];
  }
  read(id: string) {
    return {
      id,
      from: 'Prof. Saulo <saulo@uvv.br>',
      subject: 'Trabalho de Banco de Dados',
      date: 'Mon, 5 Oct 2026 10:00:00 -0300',
      snippet: 'A entrega mudou para o AVA.',
      body: 'Pessoal, a entrega do trabalho agora é pelo AVA, até quarta.',
      attachments: [],
    };
  }
}

export interface Recorded {
  statuses: UserTaskStatus[];
  reminders: PersonalReminder[];
  memory: MemoryFact[];
  forgotten: string[];
  pending: PendingAction[];
  refreshes: number;
}

export function fakeDeps(
  overrides: Partial<AssistantDeps> & { items: AcademicItem[]; now: Date },
): { deps: AssistantDeps; recorded: Recorded; calendar: FakeCalendar; gmail: FakeGmail } {
  const recorded: Recorded = {
    statuses: [],
    reminders: [],
    memory: [],
    forgotten: [],
    pending: [],
    refreshes: 0,
  };
  const calendar = (overrides.calendar as FakeCalendar | undefined) ?? new FakeCalendar();
  const gmail = new FakeGmail();
  let counter = 0;
  const deps: AssistantDeps = {
    chatId: '42',
    memory: [],
    reminders: [],
    calendar,
    gmail,
    refreshSources: () => {
      recorded.refreshes += 1;
      return { status: 'started', message: 'Coleta iniciada.' };
    },
    store: {
      setStatus: (record) => recorded.statuses.push(record),
      saveReminder: (reminder) => recorded.reminders.push(reminder),
      saveMemory: (fact) => recorded.memory.push(fact),
      deleteMemory: (id) => recorded.forgotten.push(id),
    },
    requestConfirmation: (action) => recorded.pending.push(action),
    newId: () => {
      counter += 1;
      return `id${String(counter).padStart(6, '0')}`;
    },
    ...overrides,
  };
  return { deps, recorded, calendar, gmail };
}
