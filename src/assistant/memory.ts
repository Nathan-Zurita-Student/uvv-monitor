import {
  memoryCategories,
  type InfoSource,
  type MemoryCategory,
  type MemoryFact,
  type PersonalReminder,
} from './types.js';
import { shortWeekdayLabel, TIME_PATTERN } from './dates.js';

export const MAX_MEMORY_FACTS = 60;
const MAX_CONTENT = 300;

export function memoryFromRow(row: string[]): MemoryFact | undefined {
  const category = row[1] as MemoryCategory;
  if (!row[0] || !(memoryCategories as readonly string[]).includes(category)) return undefined;
  const weekdays = (row[4] ?? '')
    .split(',')
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6);
  return {
    id: row[0],
    category,
    subject: row[2] ?? '',
    content: row[3] ?? '',
    ...(weekdays.length > 0 && row[4] ? { weekdays } : {}),
    ...(TIME_PATTERN.test(row[5] ?? '') ? { startTime: row[5] } : {}),
    ...(TIME_PATTERN.test(row[6] ?? '') ? { endTime: row[6] } : {}),
    createdAt: row[7] ?? '',
    updatedAt: row[8] ?? '',
  };
}

export function memoryToRow(fact: MemoryFact): string[] {
  return [
    fact.id,
    fact.category,
    fact.subject,
    fact.content,
    fact.weekdays?.join(',') ?? '',
    fact.startTime ?? '',
    fact.endTime ?? '',
    fact.createdAt,
    fact.updatedAt,
  ];
}

function normalized(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Uma informação por categoria + assunto: "aula / Linguagens Formais" é atualizada, não duplicada. */
export function memoryId(category: MemoryCategory, subject: string): string {
  let hash = 2166136261;
  for (const char of `${category}:${normalized(subject)}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `MEM-${(hash >>> 0).toString(36).toUpperCase()}`;
}

export interface MemoryInput {
  category: MemoryCategory;
  subject: string;
  content: string;
  weekdays?: number[] | null;
  startTime?: string | null;
  endTime?: string | null;
}

export function buildMemoryFact(input: MemoryInput, existing: MemoryFact[], now: Date): MemoryFact {
  if (!(memoryCategories as readonly string[]).includes(input.category))
    throw new Error('Categoria de memória inválida.');
  const subject = input.subject.replace(/\s+/g, ' ').trim().slice(0, 80);
  const content = input.content.replace(/\s+/g, ' ').trim().slice(0, MAX_CONTENT);
  if (!subject || !content) throw new Error('Preciso de um assunto e do que lembrar.');
  for (const time of [input.startTime, input.endTime]) {
    if (time && !TIME_PATTERN.test(time)) throw new Error('Horário inválido; use HH:mm.');
  }
  const weekdays = [...new Set(input.weekdays ?? [])].filter(
    (day) => Number.isInteger(day) && day >= 0 && day <= 6,
  );
  const id = memoryId(input.category, subject);
  const previous = existing.find((fact) => fact.id === id);
  if (!previous && existing.length >= MAX_MEMORY_FACTS)
    throw new Error('A memória está cheia. Peça para eu esquecer algo antigo antes.');
  return {
    id,
    category: input.category,
    subject,
    content,
    ...(weekdays.length > 0 ? { weekdays: weekdays.sort() } : {}),
    ...(input.startTime ? { startTime: input.startTime } : {}),
    ...(input.endTime ? { endTime: input.endTime } : {}),
    createdAt: previous?.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

/** Texto compacto da memória, enviado em toda conversa (é pequeno e define a rotina do aluno). */
export function memoryContext(facts: MemoryFact[]): string {
  if (facts.length === 0) return 'Nenhuma informação salva ainda.';
  return facts
    .slice(0, MAX_MEMORY_FACTS)
    .map((fact) => {
      const days = fact.weekdays?.map(shortWeekdayLabel).join('/');
      const time = fact.startTime
        ? ` ${fact.startTime}${fact.endTime ? `-${fact.endTime}` : ''}`
        : '';
      return `[${fact.id}] ${fact.category} · ${fact.subject}${days ? ` · ${days}` : ''}${time}: ${fact.content}`;
    })
    .join('\n')
    .slice(0, 4000);
}

/** Aulas e rotinas semanais com dia e horário, usadas na agenda e no cálculo de horário livre. */
export interface WeeklySlot {
  id: string;
  title: string;
  weekday: number;
  startTime: string;
  endTime: string;
  category: MemoryCategory;
  /** "portal" para o Quadro de Horários; sem valor = memória do usuário. */
  source?: InfoSource;
  discipline?: string;
  /** Disciplina EAD: horário de referência, sem aula presencial. */
  online?: boolean;
}

export function weeklySlots(facts: MemoryFact[]): WeeklySlot[] {
  return facts.flatMap((fact) => {
    if (!['aula', 'rotina'].includes(fact.category) || !fact.weekdays || !fact.startTime) return [];
    const endTime = fact.endTime ?? addMinutes(fact.startTime, fact.category === 'aula' ? 100 : 60);
    return fact.weekdays.map((weekday) => ({
      id: fact.id,
      title: fact.category === 'aula' ? `Aula de ${fact.subject}` : fact.subject,
      weekday,
      startTime: fact.startTime!,
      endTime,
      category: fact.category,
      ...(fact.category === 'aula' ? { discipline: fact.subject } : {}),
    }));
  });
}

function addMinutes(time: string, minutes: number): string {
  const [hours = 0, mins = 0] = time.split(':').map(Number);
  const total = Math.min(23 * 60 + 59, hours * 60 + mins + minutes);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function personalReminderFromRow(row: string[]): PersonalReminder | undefined {
  if (!row[0] || !row[3]) return undefined;
  return {
    id: row[0],
    title: row[1] ?? '',
    description: row[2] ?? '',
    remindAt: row[3],
    urgent: row[4] === 'true',
    chatId: row[5] ?? '',
    ...(row[6] ? { itemId: row[6] } : {}),
    ...(row[7] ? { calendarEventId: row[7] } : {}),
    ...(row[8] ? { sentAt: row[8] } : {}),
  };
}

export function personalReminderToRow(reminder: PersonalReminder): string[] {
  return [
    reminder.id,
    reminder.title,
    reminder.description,
    reminder.remindAt,
    String(reminder.urgent),
    reminder.chatId,
    reminder.itemId ?? '',
    reminder.calendarEventId ?? '',
    reminder.sentAt ?? '',
  ];
}
