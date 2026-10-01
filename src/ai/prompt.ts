import type { AcademicAnalysisRequest } from './types.js';

const sensitivePatterns: Array<[RegExp, string]> = [
  [/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[EMAIL_REMOVIDO]'],
  [/\b\d{9,14}\b/g, '[IDENTIFICADOR_REMOVIDO]'],
  [/(?:token|senha|password|authorization)\s*[:=]\s*\S+/gi, '$1=[SEGREDO_REMOVIDO]'],
];

export function redactAcademicText(value: string): string {
  return sensitivePatterns.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    value,
  );
}

export function buildAcademicPrompt(request: AcademicAnalysisRequest): string {
  const { item, maxInputCharacters } = request;
  const content = redactAcademicText(item.description).slice(0, maxInputCharacters);
  return `Você é uma camada de organização acadêmica. Analise SOMENTE o conteúdo fornecido.

Regras obrigatórias:
- Nunca invente datas, horários, pesos, materiais, obrigatoriedade ou conteúdo de prova.
- Diferencie fato confirmado de inferência.
- Escreva em português brasileiro simples e direto.
- actionItems deve dizer concretamente o que o aluno precisa fazer.
- studyTopics deve conter apenas conteúdos de estudo explicitamente mencionados.
- materials deve listar somente arquivos, links ou materiais explicitamente mencionados.
- openQuestions deve apontar informações importantes ausentes ou ambíguas.
- Responda exclusivamente JSON válido, sem markdown.

Formato:
{"plainSummary":"...","actionItems":[],"studyTopics":[],"materials":[],"openQuestions":[],"suggestedType":"ACTIVITY","certainty":"CONFIRMED"}

Origem: ${item.source}
Disciplina: ${redactAcademicText(item.discipline ?? 'não informada')}
Título: ${redactAcademicText(item.title)}
Tipo determinado pelo sistema: ${item.type}
Data oficial já validada: ${item.officialDeadline ?? item.officialDate ?? 'não informada'}
Conteúdo:
${content}`;
}
