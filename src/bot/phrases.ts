/** Hash simples e estável (FNV-1a) para escolher variações sem depender de crypto. */
function hash(value: string): number {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return result >>> 0;
}

/** Escolhe uma variação de frase; a mesma semente sempre gera a mesma frase. */
export function pick(options: readonly string[], seed: string): string {
  return options[hash(seed) % options.length] ?? options[0] ?? '';
}

export const phrases = {
  newActivity: [
    '👀 Apareceu uma atividade nova no AVA.',
    '🎓 Tem novidade na UVV.',
    '📝 Encontrei uma atividade nova pra você.',
    '🎓 Nova atividade pra você.',
  ],
  newExam: [
    '📝 Marcaram uma prova.',
    '🎓 Tem prova nova no calendário.',
    '📝 Encontrei uma prova nova pra você.',
  ],
  changedDate: [
    '📅 Mudaram a data dessa aqui.',
    '📅 Atenção: o prazo mudou.',
    '📅 Essa teve a data alterada.',
  ],
  updated: [
    '✏️ O professor atualizou essa aqui.',
    '✏️ Teve atualização nessa atividade.',
    '✏️ Saiu uma atualização.',
  ],
  soon: [
    '⏰ Essa aqui está chegando perto do prazo.',
    '⚠️ Só pra não deixar passar: o prazo está chegando.',
    '⏰ Fica de olho nessa, o prazo está perto.',
  ],
  reminder: [
    '⏰ Você pediu pra eu te lembrar.',
    '⏰ Lembrete combinado:',
    '⏰ Passando pra lembrar.',
  ],
  done: [
    '✅ Fechado. Marquei como concluída.',
    '✅ Boa! Tirei essa da sua lista.',
    '✅ Pronto, mais uma resolvida.',
  ],
  ignored: ['🙈 Beleza, não vou mais mostrar essa.', '🙈 Ok, escondi essa da sua lista.'],
  reopened: ['↩️ Voltou pra sua lista.', '↩️ Reabri essa pra você.'],
  undone: ['↩️ Desfeito.', '↩️ Pronto, voltei como estava.'],
} as const;
