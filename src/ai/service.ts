import type { AppConfig } from '../config/env.js';
import type { AcademicItem } from '../models/academic-item.js';
import { generateContentHash } from '../utils/hash.js';
import { logger } from '../utils/logger.js';
import { GeminiAiProvider } from './gemini-provider.js';
import { OpenAiProvider } from './openai-provider.js';
import type { AcademicAnalysis, AiProvider } from './types.js';

export function createAiProvider(config: AppConfig): AiProvider | undefined {
  if (!config.AI_ENABLED) return undefined;
  if (config.AI_PROVIDER === 'gemini') {
    if (!config.GEMINI_API_KEY) throw new Error('AI_ENABLED=true exige GEMINI_API_KEY.');
    return new GeminiAiProvider(config.GEMINI_API_KEY, config.GEMINI_MODEL);
  }
  if (!config.OPENAI_API_KEY) throw new Error('AI_ENABLED=true exige OPENAI_API_KEY.');
  return new OpenAiProvider(config.OPENAI_API_KEY, config.OPENAI_MODEL);
}

export function analysisInputHash(item: AcademicItem): string {
  return generateContentHash({
    source: item.source,
    externalId: item.externalId,
    discipline: item.discipline ?? '',
    title: item.title,
    description: item.description,
    type: item.type,
    ...(item.officialDeadline ? { officialDeadline: item.officialDeadline } : {}),
    ...(item.officialDate ? { officialDate: item.officialDate } : {}),
  });
}

function analysisMetadata(analysis: AcademicAnalysis, provider: AiProvider, hash: string) {
  return {
    aiProvider: provider.name,
    aiInputHash: hash,
    aiAnalyzedAt: new Date().toISOString(),
    aiSummary: analysis.plainSummary,
    aiActions: JSON.stringify(analysis.actionItems),
    aiStudyTopics: JSON.stringify(analysis.studyTopics),
    aiMaterials: JSON.stringify(analysis.materials),
    aiOpenQuestions: JSON.stringify(analysis.openQuestions),
    aiCertainty: analysis.certainty,
    ...(analysis.suggestedType ? { aiSuggestedType: analysis.suggestedType } : {}),
  };
}

export async function enrichItemsWithAi(
  items: AcademicItem[],
  provider: AiProvider | undefined,
  options: { maxCalls: number; maxInputCharacters: number },
): Promise<{ items: AcademicItem[]; calls: number; errors: string[] }> {
  if (!provider || options.maxCalls === 0) return { items, calls: 0, errors: [] };
  let calls = 0;
  const errors: string[] = [];
  const enriched: AcademicItem[] = [];
  for (const item of items) {
    const hash = analysisInputHash(item);
    if (item.metadata?.aiInputHash === hash || calls >= options.maxCalls) {
      enriched.push(item);
      continue;
    }
    calls += 1;
    try {
      const analysis = await provider.analyze({
        item,
        maxInputCharacters: options.maxInputCharacters,
      });
      enriched.push({
        ...item,
        metadata: { ...item.metadata, ...analysisMetadata(analysis, provider, hash) },
      });
    } catch (error) {
      const message = `${item.id}: ${error instanceof Error ? error.message : 'erro desconhecido'}`;
      errors.push(message);
      enriched.push(item);
      logger.warn({ module: 'AI', provider: provider.name, itemId: item.id }, message);
    }
  }
  return { items: enriched, calls, errors };
}
