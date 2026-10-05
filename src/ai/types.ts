import type { AcademicItem, ItemType } from '../models/academic-item.js';

export const certaintyLevels = ['CONFIRMED', 'INFERRED', 'NOT_INFORMED'] as const;
export type CertaintyLevel = (typeof certaintyLevels)[number];

export const relevanceLevels = ['ACTION_REQUIRED', 'INFORMATIVE', 'IRRELEVANT'] as const;
export type RelevanceLevel = (typeof relevanceLevels)[number];

export interface DueDateEvidence {
  /** AAAA-MM-DD */
  date: string;
  /** HH:MM */
  time?: string;
  /** Trecho literal do texto que contém a data. */
  evidence: string;
}

export interface AcademicAnalysis {
  displayTitle?: string;
  plainSummary: string;
  actionItems: string[];
  studyTopics: string[];
  materials: string[];
  openQuestions: string[];
  suggestedType?: ItemType;
  relevance?: RelevanceLevel;
  dueDate?: DueDateEvidence;
  certainty: CertaintyLevel;
}

/** Arquivo anexado ao aviso (PDF, DOCX...) com o texto já extraído. */
export interface AnalysisAttachment {
  name: string;
  text: string;
}

export interface AcademicAnalysisRequest {
  item: AcademicItem;
  maxInputCharacters: number;
  now?: Date;
  attachments?: AnalysisAttachment[];
}

export interface AiProvider {
  readonly name: string;
  /** Envia o prompt e devolve o objeto JSON respondido pelo modelo. */
  generateJson(prompt: string): Promise<unknown>;
}
