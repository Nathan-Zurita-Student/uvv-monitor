import { z } from 'zod';
import { itemTypes } from '../models/academic-item.js';
import { certaintyLevels, relevanceLevels, type AcademicAnalysis } from './types.js';

/** Lista de textos tolerante: corta excessos em vez de rejeitar a análise inteira. */
function textList(maxItems: number) {
  return z
    .array(z.unknown())
    .default([])
    .catch([])
    .transform((values) =>
      values
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim().slice(0, 300))
        .filter(Boolean)
        .slice(0, maxItems),
    );
}

const dueDateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional()
    .catch(undefined),
  evidence: z.string().trim().min(1).max(400),
});

export const academicAnalysisSchema = z.object({
  displayTitle: z
    .string()
    .trim()
    .min(1)
    .transform((value) => value.slice(0, 90))
    .optional()
    .catch(undefined),
  plainSummary: z
    .string()
    .trim()
    .min(1)
    .transform((value) => value.slice(0, 1_500)),
  actionItems: textList(8),
  studyTopics: textList(12),
  materials: textList(12),
  openQuestions: textList(8),
  // Campos opcionais: um valor fora da lista não deve descartar a análise inteira.
  suggestedType: z.enum(itemTypes).optional().catch(undefined),
  relevance: z.enum(relevanceLevels).optional().catch(undefined),
  dueDate: dueDateSchema.nullable().optional().catch(undefined),
  certainty: z.enum(certaintyLevels).catch('NOT_INFORMED'),
});

export function parseAcademicAnalysis(value: unknown): AcademicAnalysis {
  const parsed = academicAnalysisSchema.parse(value);
  return {
    ...(parsed.displayTitle ? { displayTitle: parsed.displayTitle } : {}),
    plainSummary: parsed.plainSummary,
    actionItems: parsed.actionItems,
    studyTopics: parsed.studyTopics,
    materials: parsed.materials,
    openQuestions: parsed.openQuestions,
    certainty: parsed.certainty,
    ...(parsed.suggestedType ? { suggestedType: parsed.suggestedType } : {}),
    ...(parsed.relevance ? { relevance: parsed.relevance } : {}),
    ...(parsed.dueDate
      ? {
          dueDate: {
            date: parsed.dueDate.date,
            evidence: parsed.dueDate.evidence,
            ...(parsed.dueDate.time ? { time: parsed.dueDate.time } : {}),
          },
        }
      : {}),
  };
}

export function parseJsonObject(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  return JSON.parse((fenced ?? text).trim()) as unknown;
}
