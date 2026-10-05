/**
 * Quadro de horários do Portal do Aluno. Sem dependências do Node: o monitor grava na planilha e o
 * bot no Apps Script lê a mesma aba.
 */
export interface ClassSlot {
  /** Sigla usada no quadro, ex.: "DESENV". */
  code: string;
  discipline: string;
  /** 0 = domingo ... 6 = sábado. */
  weekday: number;
  startTime: string;
  endTime: string;
  /** Disciplina EAD: o horário é de referência, sem aula presencial. */
  online: boolean;
  /** Período acadêmico, ex.: "2026/2". */
  period: string;
}

export const weekdayNames = [
  'domingo',
  'segunda',
  'terça',
  'quarta',
  'quinta',
  'sexta',
  'sábado',
] as const;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function classSlotId(slot: ClassSlot): string {
  return `CLS-${slot.code}-${String(slot.weekday)}-${slot.startTime.replace(':', '')}`;
}

export function classSlotToRow(slot: ClassSlot, updatedAt: string): string[] {
  return [
    classSlotId(slot),
    slot.code,
    slot.discipline,
    String(slot.weekday),
    slot.startTime,
    slot.endTime,
    String(slot.online),
    slot.period,
    updatedAt,
  ];
}

export function classSlotFromRow(row: string[]): ClassSlot | undefined {
  const weekday = Number(row[3]);
  if (!row[0] || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) return undefined;
  if (!TIME.test(row[4] ?? '') || !TIME.test(row[5] ?? '')) return undefined;
  return {
    code: row[1] ?? '',
    discipline: row[2] || row[1] || '',
    weekday,
    startTime: row[4]!,
    endTime: row[5]!,
    online: row[6] === 'true',
    period: row[7] ?? '',
  };
}

/** "CC6N - Desenvolvimento de Games" e "DESENVOLVIMENTO DE GAMES" viram "desenvolvimento de games". */
export function normalizeDiscipline(value: string | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/^\s*[a-z]{1,3}\d+[a-z]?\.?\s*-\s*/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function sameDiscipline(left: string | undefined, right: string | undefined): boolean {
  const a = normalizeDiscipline(left);
  const b = normalizeDiscipline(right);
  if (a.length < 4 || b.length < 4) return false;
  return (
    a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `) || a.includes(b) || b.includes(a)
  );
}

/** Texto de entrega que acontece na própria aula (apresentação, execução no laboratório...). */
export const IN_CLASS_PATTERN =
  /apresenta|semin[aá]rio|\bno lab|laborat[oó]rio|em sala|execu[cç][aã]o|defesa|prova pr[aá]tica/i;

/** Aula presencial da disciplina naquele dia da semana (o bloco que começa mais cedo). */
export function classOn(
  slots: readonly ClassSlot[],
  discipline: string | undefined,
  weekday: number,
): ClassSlot | undefined {
  return slots
    .filter(
      (slot) =>
        !slot.online && slot.weekday === weekday && sameDiscipline(slot.discipline, discipline),
    )
    .sort((left, right) => left.startTime.localeCompare(right.startTime))[0];
}
