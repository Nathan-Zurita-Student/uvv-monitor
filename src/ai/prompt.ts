import { publishedAt } from '../agenda/focus.js';
import { itemTypes } from '../models/academic-item.js';
import { formatLongDay, localDateKey } from '../utils/dates.js';
import { certaintyLevels, relevanceLevels, type AcademicAnalysisRequest } from './types.js';

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
  const now = request.now ?? new Date();
  const content = redactAcademicText(item.description).slice(0, maxInputCharacters);
  return `Você organiza a vida acadêmica de um estudante universitário cujo foco são provas, trabalhos e tarefas. Analise SOMENTE o conteúdo fornecido.

Hoje é ${formatLongDay(now)} de ${localDateKey(now).slice(0, 4)}.

Regras obrigatórias:
- Nunca invente datas, horários, pesos, materiais, obrigatoriedade ou conteúdo de prova.
- Diferencie fato confirmado de inferência.
- Escreva em português brasileiro simples e direto.

Campos:
- displayTitle: título curto e claro (até 60 caracteres), sem o nome da disciplina e sem datas. Exemplos: "Prova do 1º bimestre", "Trabalho prático em grupo", "Pesquisa de avaliação institucional".
- plainSummary: 1 ou 2 frases curtas dizendo o que é e o que importa para o aluno.
- actionItems: o que o aluno precisa fazer concretamente; lista vazia se não houver ação.
- studyTopics: apenas conteúdos de estudo explicitamente mencionados.
- materials: apenas arquivos, links ou materiais explicitamente mencionados.
- openQuestions: informações importantes ausentes ou ambíguas (por exemplo horário, peso, formato de entrega).
- suggestedType: exatamente um destes valores: ${itemTypes.join(', ')}. Use EXAM para provas e avaliações presenciais; ASSIGNMENT, AOP ou ACTIVITY para trabalhos, entregas e tarefas; NOTICE para avisos sem ação.
- relevance: ACTION_REQUIRED se o aluno precisa fazer algo (estudar para prova, entregar, apresentar, resolver pendência); INFORMATIVE se é um aviso acadêmico útil sem ação; IRRELEVANT se é propaganda, vaga de emprego, newsletter, pesquisa opcional ou não tem relação com as disciplinas.
- dueDate: somente se o texto informar explicitamente a data da prova ou o prazo de entrega. Formato {"date":"AAAA-MM-DD","time":"HH:MM","evidence":"trecho copiado literalmente do texto contendo a data"}. Sem ano explícito, use o ano mais próximo da data de referência. Omita time sem horário explícito. Use null quando não houver data explícita.
- certainty: exatamente um destes valores: ${certaintyLevels.join(', ')}.
- Valores permitidos para relevance: ${relevanceLevels.join(', ')}.
- Responda exclusivamente JSON válido, sem markdown.

Formato:
{"displayTitle":"...","plainSummary":"...","actionItems":[],"studyTopics":[],"materials":[],"openQuestions":[],"suggestedType":"ACTIVITY","relevance":"ACTION_REQUIRED","dueDate":null,"certainty":"CONFIRMED"}

Origem: ${item.source}
Data de referência (publicação): ${localDateKey(publishedAt(item, now))}
Disciplina: ${redactAcademicText(item.discipline ?? 'não informada')}
Título: ${redactAcademicText(item.title)}
Tipo determinado pelo sistema: ${item.type}
Data oficial já validada: ${item.officialDeadline ?? item.officialDate ?? 'não informada'}
Conteúdo:
${content}`;
}
