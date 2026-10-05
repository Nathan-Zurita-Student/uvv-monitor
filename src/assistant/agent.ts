import { localDateKey } from '../utils/dates.js';
import { dateReference, localTime, longDayLabel } from './dates.js';
import { memoryContext } from './memory.js';
import { ASSISTANT_INSTRUCTIONS, REPLY_SCHEMA } from './prompt.js';
import { toolDefinitions, type ToolRunner } from './tools.js';
import type { Insight, MemoryFact, PendingAction } from './types.js';

export const ASSISTANT_MODEL = 'gpt-5.4-mini';
/** Preço por token do modelo (US$); a entrada em cache custa 10% da normal. */
export const PRICES = {
  input: 0.75 / 1_000_000,
  cachedInput: 0.075 / 1_000_000,
  output: 4.5 / 1_000_000,
};
export const MAX_OUTPUT_TOKENS = 2000;
export const MAX_ROUNDS = 5;
const MAX_TOOL_OUTPUT = 12_000;

export interface Reference {
  id: string;
  label: string;
  kind: string;
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  text: string;
  refs?: Reference[];
}

export interface Usage {
  input: number;
  cached: number;
  output: number;
}

interface OutputItem {
  type?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  content?: Array<{ type?: string; text?: string }>;
}

export interface ModelResponse {
  status?: string;
  output?: OutputItem[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
  };
  incomplete_details?: { reason?: string };
}

/** Chamada ao modelo (UrlFetchApp no Apps Script, função falsa nos testes). */
export type ModelCaller = (request: Record<string, unknown>) => ModelResponse;

export function costOf(usage: Usage): number {
  const fresh = Math.max(0, usage.input - usage.cached);
  return fresh * PRICES.input + usage.cached * PRICES.cachedInput + usage.output * PRICES.output;
}

/** Teto conservador de custo de uma chamada, para reservar orçamento antes de chamar. */
export function reservationFor(request: Record<string, unknown>): number {
  const bytes = encodeURIComponent(JSON.stringify(request)).replace(/%[A-F\d]{2}/gi, 'x').length;
  return (bytes / 3) * PRICES.input + MAX_OUTPUT_TOKENS * PRICES.output;
}

export function redact(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email]')
    .replace(/\b(?:sk-[\w-]{12,}|AIza[\w-]{15,}|\d{6,}:[\w-]{20,})\b/g, '[segredo]')
    .replace(/\b\d{11,}\b/g, '[identificador]');
}

export interface TurnContext {
  now: Date;
  memory: MemoryFact[];
  alerts: Insight[];
  /** Alertas já mencionados recentemente (não repetir). */
  mentionedAlerts?: string[];
  pending?: PendingAction;
  replyContext?: string;
  lastSyncAt?: string;
  /** Aulas de hoje segundo o Quadro de Horários (com as canceladas). */
  classesToday?: string;
}

/** Contexto dinâmico curto enviado em toda mensagem: data, memória, alertas e pendências. */
export function turnContext(input: TurnContext, history: ConversationTurn[]): string {
  const { now } = input;
  const lines = [
    `Agora: ${longDayLabel(localDateKey(now))} de ${localDateKey(now).slice(0, 4)}, ${localTime(now)} (America/Sao_Paulo).`,
    `Datas de referência:\n${dateReference(now)}`,
    `Memória do usuário:\n${memoryContext(input.memory)}`,
  ];
  if (input.classesToday) lines.push(`Aulas de hoje (Quadro de Horários): ${input.classesToday}`);
  const mentioned = new Set(input.mentionedAlerts ?? []);
  const alerts = input.alerts.filter((alert) => !mentioned.has(alert.key)).slice(0, 3);
  if (alerts.length > 0)
    lines.push(
      `Alertas atuais (use no máximo um, com "Aliás,"):\n${alerts.map((alert) => `- ${alert.text}`).join('\n')}`,
    );
  const refs = history
    .filter((turn) => turn.role === 'assistant')
    .slice(-2)
    .flatMap((turn) => turn.refs ?? []);
  if (refs.length > 0)
    lines.push(
      `Itens citados recentemente: ${refs
        .slice(-8)
        .map((ref) => `${ref.label} [${ref.kind} ${ref.id}]`)
        .join('; ')}`,
    );
  if (input.pending)
    lines.push(
      `Ação aguardando confirmação do usuário (botão ou "sim"): ${input.pending.summary}.`,
    );
  if (input.replyContext)
    lines.push(
      `O usuário respondeu a esta mensagem (só contexto): "${redact(input.replyContext).slice(0, 800)}"`,
    );
  if (input.lastSyncAt) {
    const sync = new Date(input.lastSyncAt);
    if (!Number.isNaN(sync.getTime()))
      lines.push(
        `Última coleta do Portal/AVA/e-mail: ${longDayLabel(localDateKey(sync))} às ${localTime(sync)}.`,
      );
  }
  return lines.join('\n\n');
}

export interface AgentInput {
  text: string;
  history: ConversationTurn[];
  context: string;
  model?: string;
  reasoningEffort?: string;
}

export interface AgentResult {
  reply: string;
  referenced: Reference[];
  usage: Usage;
  rounds: number;
}

function messageText(response: ModelResponse): string | undefined {
  return response.output
    ?.filter((item) => item.type === 'message' || item.content)
    .flatMap((item) => item.content ?? [])
    .find((part) => part.type === 'output_text' && part.text)?.text;
}

function parseFinal(text: string): { reply: string; referenced: Reference[] } {
  try {
    const parsed = JSON.parse(text) as { reply?: unknown; referenced?: unknown };
    if (typeof parsed.reply === 'string') {
      const referenced = Array.isArray(parsed.referenced)
        ? parsed.referenced
            .filter(
              (ref): ref is Reference =>
                typeof ref === 'object' &&
                ref !== null &&
                typeof (ref as Reference).id === 'string' &&
                typeof (ref as Reference).label === 'string',
            )
            .slice(0, 10)
            .map((ref) => ({
              id: ref.id.slice(0, 80),
              label: ref.label.slice(0, 80),
              kind: typeof ref.kind === 'string' ? ref.kind : 'atividade',
            }))
        : [];
      return { reply: parsed.reply, referenced };
    }
  } catch {
    // Resposta fora do formato: usa o texto como veio.
  }
  return { reply: text, referenced: [] };
}

export class AssistantError extends Error {}

function clockKey(hours: string, minutes: string | undefined): string {
  return `${hours.padStart(2, '0')}:${minutes ?? '00'}`;
}

/** Horários presentes nos dados consultados ("19:00", "19h", "19h30"). */
function groundedTimes(text: string): Set<string> {
  const times = new Set<string>();
  for (const match of text.matchAll(/\b([01]?\d|2[0-3])(?::|h)([0-5]\d)?\b/g)) {
    times.add(clockKey(match[1] ?? '0', match[2]));
  }
  return times;
}

/**
 * Horários afirmados como fato na resposta ("às 19h", "das 14h às 15h30", "até 23:59") que não
 * aparecem em nenhum dado consultado. Horários de um cronograma proposto ("14h–16h") não contam.
 */
export function ungroundedTimes(reply: string, grounding: string): string[] {
  const known = groundedTimes(grounding);
  const claimed = [
    ...reply.matchAll(
      // Sem \b no começo: em JavaScript ele não reconhece letras acentuadas como "à".
      /(?:^|[\s(,])(?:às|as|das|até|ate|começa|termina)\s+([01]?\d|2[0-3])(?::|h)([0-5]\d)?\b/gi,
    ),
  ].map((match) => clockKey(match[1] ?? '0', match[2]));
  return [...new Set(claimed.filter((time) => !known.has(time)))];
}

/**
 * Laço do agente: o modelo decide quais ferramentas chamar, recebe os resultados e escreve a
 * resposta final. Limita a quantidade de rodadas; na última, obriga uma resposta sem ferramentas.
 * Antes de devolver, confere se algum horário afirmado não veio dos dados e, se for o caso, pede
 * uma única reescrita.
 */
export function runAgent(
  input: AgentInput,
  runner: ToolRunner,
  callModel: ModelCaller,
): AgentResult {
  const conversation: unknown[] = [
    { role: 'developer', content: input.context },
    ...input.history.slice(-6).map((turn) => ({
      role: turn.role,
      content: redact(turn.text).slice(0, 1200),
    })),
    { role: 'user', content: redact(input.text).slice(0, 2500) },
  ];
  const grounding = [input.context, input.text, ...input.history.map((turn) => turn.text)];
  const usage: Usage = { input: 0, cached: 0, output: 0 };
  const ask = (toolChoice: 'auto' | 'none'): ModelResponse => {
    const response = callModel({
      model: input.model ?? ASSISTANT_MODEL,
      instructions: ASSISTANT_INSTRUCTIONS,
      input: conversation,
      tools: toolDefinitions,
      tool_choice: toolChoice,
      parallel_tool_calls: true,
      reasoning: { effort: input.reasoningEffort ?? 'low' },
      text: {
        format: { type: 'json_schema', name: 'telegram_reply', strict: true, schema: REPLY_SCHEMA },
      },
      max_output_tokens: MAX_OUTPUT_TOKENS,
      store: false,
      include: ['reasoning.encrypted_content'],
      prompt_cache_key: 'uvv-academic-assistant',
    });
    usage.input += response.usage?.input_tokens ?? 0;
    usage.cached += response.usage?.input_tokens_details?.cached_tokens ?? 0;
    usage.output += response.usage?.output_tokens ?? 0;
    return response;
  };
  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    const last = round === MAX_ROUNDS;
    const response = ask(last ? 'none' : 'auto');
    const calls = (response.output ?? []).filter((item) => item.type === 'function_call');
    if (calls.length === 0 || last) {
      const text = messageText(response);
      if (!text) {
        throw new AssistantError(
          response.status === 'incomplete'
            ? 'Essa resposta ficou grande demais. Pode pedir de um jeito mais específico?'
            : 'Não consegui montar a resposta agora. Tenta de novo?',
        );
      }
      let final = parseFinal(text);
      const invented = ungroundedTimes(final.reply, grounding.join('\n'));
      if (invented.length > 0) {
        conversation.push(...(response.output ?? []), {
          role: 'developer',
          content: `Revise a resposta: você afirmou o horário ${invented.join(', ')}, que não aparece em nenhum dado consultado. Reescreva a mesma resposta, natural, sem esse horário; se ele não foi informado, diga isso. Não mencione esta revisão.`,
        });
        const fixed = messageText(ask('none'));
        if (fixed) final = parseFinal(fixed);
        return { ...final, usage, rounds: round + 1 };
      }
      return { ...final, usage, rounds: round };
    }
    conversation.push(...(response.output ?? []));
    for (const call of calls) {
      const result = runner.run(call.name ?? '', call.arguments ?? '{}');
      let output = JSON.stringify(result ?? null);
      if (output.length > MAX_TOOL_OUTPUT) output = `${output.slice(0, MAX_TOOL_OUTPUT)}…(cortado)`;
      grounding.push(output);
      conversation.push({ type: 'function_call_output', call_id: call.call_id, output });
    }
  }
  throw new AssistantError('Não consegui montar a resposta agora. Tenta de novo?');
}
