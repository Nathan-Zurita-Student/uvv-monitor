import type { ParsedGmailMessage } from './types.js';

const academicTerms = [
  'uvv',
  'universidade vila velha',
  'professor',
  'coordenação',
  'coordenacao',
  'secretaria',
  'portal do aluno',
  'ava',
  'disciplina',
  'prova',
  'avaliação',
  'avaliacao',
  'trabalho',
  'aop',
  'atividade',
  'estágio',
  'estagio',
  'documento',
  'pendência',
  'pendencia',
  'aula',
];

export interface RelevanceResult {
  relevant: boolean;
  score: number;
  reasons: string[];
}

export function classifyGmailRelevance(message: ParsedGmailMessage): RelevanceResult {
  const combined = `${message.from}\n${message.subject}\n${message.body}`.toLowerCase();
  const reasons: string[] = [];
  let score = 0;
  if (/@uvv\.br\b/i.test(message.from)) {
    score += 4;
    reasons.push('remetente @uvv.br');
  }
  for (const term of academicTerms) {
    if (combined.includes(term)) {
      score += ['prova', 'avaliação', 'trabalho', 'aop', 'pendência'].includes(term) ? 2 : 1;
      reasons.push(`termo:${term}`);
    }
  }
  return { relevant: score >= 3, score, reasons };
}
