import type { AcademicItem, ItemType } from '../models/academic-item.js';

export const certaintyLevels = ['CONFIRMED', 'INFERRED', 'NOT_INFORMED'] as const;
export type CertaintyLevel = (typeof certaintyLevels)[number];

export interface AcademicAnalysis {
  plainSummary: string;
  actionItems: string[];
  studyTopics: string[];
  materials: string[];
  openQuestions: string[];
  suggestedType?: ItemType;
  certainty: CertaintyLevel;
}

export interface AcademicAnalysisRequest {
  item: AcademicItem;
  maxInputCharacters: number;
}

export interface AiProvider {
  readonly name: string;
  analyze(request: AcademicAnalysisRequest): Promise<AcademicAnalysis>;
}
