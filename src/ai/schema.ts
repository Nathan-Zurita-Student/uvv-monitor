import { z } from 'zod';
import { itemTypes } from '../models/academic-item.js';
import { certaintyLevels, type AcademicAnalysis } from './types.js';

export const academicAnalysisSchema = z.object({
  plainSummary: z.string().trim().min(1).max(1_500),
  actionItems: z.array(z.string().trim().min(1).max(300)).max(8).default([]),
  studyTopics: z.array(z.string().trim().min(1).max(300)).max(12).default([]),
  materials: z.array(z.string().trim().min(1).max(300)).max(12).default([]),
  openQuestions: z.array(z.string().trim().min(1).max(300)).max(8).default([]),
  // Sugestão opcional: um valor fora da lista não deve descartar a análise inteira.
  suggestedType: z.enum(itemTypes).optional().catch(undefined),
  certainty: z.enum(certaintyLevels),
});

export function parseAcademicAnalysis(value: unknown): AcademicAnalysis {
  const parsed = academicAnalysisSchema.parse(value);
  return {
    plainSummary: parsed.plainSummary,
    actionItems: parsed.actionItems,
    studyTopics: parsed.studyTopics,
    materials: parsed.materials,
    openQuestions: parsed.openQuestions,
    certainty: parsed.certainty,
    ...(parsed.suggestedType ? { suggestedType: parsed.suggestedType } : {}),
  };
}

export function parseJsonObject(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  return JSON.parse((fenced ?? text).trim()) as unknown;
}
