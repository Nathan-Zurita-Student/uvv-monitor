import { effectiveDate, effectiveType, publishedAt } from '../agenda/focus.js';
import type { AppConfig } from '../config/env.js';
import type { AcademicItem } from '../models/academic-item.js';
import { calendarDaysUntil, parseAcademicDate } from '../utils/dates.js';
import { generateContentHash } from '../utils/hash.js';
import { logger } from '../utils/logger.js';
import { GeminiAiProvider } from './gemini-provider.js';
import { OpenAiProvider } from './openai-provider.js';
import { buildAcademicPrompt } from './prompt.js';
import { parseAcademicAnalysis } from './schema.js';
import type {
  AcademicAnalysis,
  AcademicAnalysisRequest,
  AiProvider,
  DueDateEvidence,
} from './types.js';

/** Aumentar quando o prompt ou o formato mudarem: força uma nova análise gradual dos itens. */
export const AI_ANALYSIS_VERSION = '3';

export function createAiProvider(config: AppConfig): AiProvider | undefined {
  if (!config.AI_ENABLED) return undefined;
  if (config.AI_PROVIDER === 'gemini') {
    if (!config.GEMINI_API_KEY) throw new Error('AI_ENABLED=true exige GEMINI_API_KEY.');
    return new GeminiAiProvider(config.GEMINI_API_KEY, config.GEMINI_MODEL);
  }
  if (!config.OPENAI_API_KEY) throw new Error('AI_ENABLED=true exige OPENAI_API_KEY.');
  return new OpenAiProvider(config.OPENAI_API_KEY, config.OPENAI_MODEL);
}

export async function analyzeItem(
  provider: AiProvider,
  request: AcademicAnalysisRequest,
): Promise<AcademicAnalysis> {
  return parseAcademicAnalysis(await provider.generateJson(buildAcademicPrompt(request)));
}

export function analysisInputHash(item: AcademicItem): string {
  return generateContentHash({
    metadata: { aiVersion: AI_ANALYSIS_VERSION },
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

function normalizeForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/["'“”‘’`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Só aceita a data da IA quando o trecho citado existe literalmente no texto e contém o dia
 * informado. Assim a data é extraída do conteúdo, nunca inventada.
 */
export function verifiedDueDate(
  analysis: AcademicAnalysis,
  item: AcademicItem,
  now = new Date(),
): DueDateEvidence | undefined {
  const due = analysis.dueDate;
  if (!due) return undefined;
  const evidence = normalizeForMatch(due.evidence);
  const source = normalizeForMatch(`${item.title}\n${item.description}`);
  if (evidence.length < 4 || !source.includes(evidence)) return undefined;
  const day = Number(due.date.slice(8, 10));
  if (!new RegExp(`(^|\\D)0?${String(day)}(\\D|$)`).test(evidence)) return undefined;
  const instant = parseAcademicDate(due.date, true);
  if (Number.isNaN(instant.getTime())) return undefined;
  const fromPublication = calendarDaysUntil(instant, publishedAt(item, now));
  if (fromPublication < -7 || fromPublication > 300) return undefined;
  return due;
}

function analysisMetadata(
  analysis: AcademicAnalysis,
  provider: AiProvider,
  hash: string,
  dueDate: DueDateEvidence | undefined,
): Record<string, string> {
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
    ...(analysis.displayTitle ? { aiDisplayTitle: analysis.displayTitle } : {}),
    ...(analysis.suggestedType ? { aiSuggestedType: analysis.suggestedType } : {}),
    ...(analysis.relevance ? { aiRelevance: analysis.relevance } : {}),
    ...(dueDate
      ? {
          aiDueDate: dueDate.time ? `${dueDate.date}T${dueDate.time}:00` : dueDate.date,
          aiDueEvidence: dueDate.evidence,
        }
      : {}),
  };
}

const focusTypes = new Set(['EXAM', 'ASSIGNMENT', 'AOP', 'ACTIVITY']);
/** Itens com data vencida há mais tempo que isso não valem uma chamada de IA. */
const staleAfterDays = 30;
const recentWithinDays = 30;

/**
 * Ordem em que o orçamento de chamadas é gasto: novidades desta execução, depois provas e
 * tarefas pela data mais próxima (sem data por último) e, por fim, avisos recentes.
 */
export function analysisQueue(
  items: AcademicItem[],
  priorityIds: ReadonlySet<string>,
  now = new Date(),
): AcademicItem[] {
  const ranked = items.flatMap((item) => {
    if (item.metadata?.contextOnly === 'true') return [];
    const date = effectiveDate(item);
    const days = date
      ? calendarDaysUntil(parseAcademicDate(date.value, date.deadline), now)
      : undefined;
    if (priorityIds.has(item.id)) return [{ item, tier: 0, order: days ?? 0 }];
    if (days !== undefined && days < -staleAfterDays) return [];
    if (focusTypes.has(item.type) || focusTypes.has(effectiveType(item))) {
      return [{ item, tier: 1, order: days ?? Number.MAX_SAFE_INTEGER }];
    }
    const recent = calendarDaysUntil(now, publishedAt(item, now)) <= recentWithinDays;
    if (recent || (days !== undefined && days >= 0)) {
      return [{ item, tier: 2, order: days ?? Number.MAX_SAFE_INTEGER }];
    }
    return [];
  });
  return ranked
    .sort((left, right) => left.tier - right.tier || left.order - right.order)
    .map(({ item }) => item);
}

export async function enrichItemsWithAi(
  items: AcademicItem[],
  provider: AiProvider | undefined,
  options: {
    maxCalls: number;
    maxInputCharacters: number;
    priorityIds?: ReadonlySet<string>;
    now?: Date;
  },
): Promise<{ items: AcademicItem[]; calls: number; errors: string[] }> {
  if (!provider || options.maxCalls === 0) return { items, calls: 0, errors: [] };
  const now = options.now ?? new Date();
  let calls = 0;
  const errors: string[] = [];
  const enriched = new Map<string, AcademicItem>();
  for (const item of analysisQueue(items, options.priorityIds ?? new Set(), now)) {
    if (calls >= options.maxCalls) break;
    const hash = analysisInputHash(item);
    if (item.metadata?.aiInputHash === hash) continue;
    calls += 1;
    try {
      const analysis = await analyzeItem(provider, {
        item,
        maxInputCharacters: options.maxInputCharacters,
        now,
      });
      const baseMetadata = Object.fromEntries(
        Object.entries(item.metadata ?? {}).filter(([key]) => !key.startsWith('ai')),
      );
      enriched.set(item.id, {
        ...item,
        metadata: {
          ...baseMetadata,
          ...analysisMetadata(analysis, provider, hash, verifiedDueDate(analysis, item, now)),
        },
      });
    } catch (error) {
      const message = `${item.id}: ${error instanceof Error ? error.message : 'erro desconhecido'}`;
      errors.push(message);
      logger.warn({ module: 'AI', provider: provider.name, itemId: item.id }, message);
    }
  }
  return { items: items.map((item) => enriched.get(item.id) ?? item), calls, errors };
}
