import { describe, expect, it } from 'vitest';
import { buildAgenda, toAgendaEntry } from '../../src/agenda/agenda.js';
import type { AcademicItem } from '../../src/models/academic-item.js';
import {
  STATUS_PLACEHOLDER,
  formatDueToday,
  formatItemCard,
  formatOtherNews,
  formatPanel,
  formatTomorrow,
  formatWeek,
  renderStatus,
} from '../../src/telegram/format.js';
import { packBlocks } from '../../src/telegram/html.js';

const now = new Date('2026-10-02T15:00:00Z'); // sexta-feira, 12h em São Paulo

let sequence = 0;
type Overrides = { [K in keyof AcademicItem]?: AcademicItem[K] | undefined };

function item(overrides: Overrides = {}): AcademicItem {
  sequence += 1;
  const merged = {
    id: `UVV-${String(sequence).padStart(6, '0')}`,
    externalId: String(sequence),
    source: 'PORTAL',
    sourceUrl: 'https://aluno.uvv.br/post/1',
    discipline: 'Cálculo Numérico',
    title: 'Entregar AOP',
    description: 'Enviar os exercícios',
    type: 'AOP',
    officialDeadline: '2026-10-03T23:59:00',
    firstSeenAt: '2026-10-01T12:00:00Z',
    lastSeenAt: '2026-10-01T12:00:00Z',
    contentHash: 'hash',
    status: 'TODO',
    urgency: 'NEXT_24_HOURS',
    ...overrides,
  };
  // Remove campos sobrescritos com undefined (exactOptionalPropertyTypes).
  return Object.fromEntries(
    Object.entries(merged).filter(([, value]) => value !== undefined),
  ) as unknown as AcademicItem;
}

const exam = () =>
  item({
    type: 'EXAM',
    title: 'Prova do 1º bimestre — Cálculo Numérico',
    officialDeadline: undefined,
    officialDate: '2026-10-05',
    metadata: {
      origin: 'OFFICIAL_EXAM_SCHEDULE',
      aiStudyTopics: '["Interpolação","Zeros de funções"]',
    },
  });

describe('painel acadêmico', () => {
  it('organiza provas e entregas com contagem regressiva e links', () => {
    const [panel] = formatPanel(
      buildAgenda(
        [exam(), item(), item({ title: 'Atrasada', officialDeadline: '2026-09-29T23:59:00' })],
        now,
      ),
    );
    expect(panel).toContain('📚 <b>PAINEL ACADÊMICO</b>');
    expect(panel).toContain('sexta-feira, 02/10');
    expect(panel).toContain('📝 <b>PROVAS</b>');
    expect(panel).toContain('<a href="https://aluno.uvv.br/post/1">Prova do 1º bimestre</a>');
    expect(panel).toContain('seg, 05/10 · <b>em 3 dias</b>');
    expect(panel).toContain('📖 Interpolação; Zeros de funções');
    expect(panel).toContain('✍️ <b>TRABALHOS E TAREFAS</b>');
    expect(panel).toContain('sáb, 03/10 · 23h59 · <b>amanhã</b> · ⏳ não iniciado');
    expect(panel).toContain('⚠️ <b>ATRASADAS</b>');
    expect(panel).not.toContain('https://aluno.uvv.br/post/1\n');
  });

  it('comemora quando não há provas nem entregas', () => {
    const [panel] = formatPanel(buildAgenda([], now));
    expect(panel).toContain('Nenhuma prova marcada por enquanto');
    expect(panel).toContain('Nenhuma entrega com prazo pela frente');
  });

  it('escapa HTML vindo das fontes', () => {
    const [panel] = formatPanel(buildAgenda([item({ title: 'Lista <1> & 2' })], now));
    expect(panel).toContain('Lista &lt;1&gt; &amp; 2');
  });
});

describe('cartões de prova e entrega', () => {
  it('mostra análise da IA e mantém o andamento substituível', () => {
    const source = item({
      metadata: {
        aiSummary: 'Lista de exercícios sobre interpolação.',
        aiActions: '["Resolver os exercícios 1 a 5"]',
        aiOpenQuestions: '["Peso não informado"]',
        aiCertainty: 'CONFIRMED',
      },
    });
    const entry = toAgendaEntry(source, now);
    if (!entry) throw new Error('entrada esperada');
    const template = formatItemCard(entry, 'NEW');
    expect(template).toContain('🆕 <b>NOVA ENTREGA</b>');
    expect(template).toContain('🧠 Lista de exercícios sobre interpolação.');
    expect(template).toContain('✅ <b>O que fazer</b>\n• Resolver os exercícios 1 a 5');
    expect(template).toContain('❓ <b>Ainda não informado</b>');
    expect(template).toContain(`📊 <b>Andamento:</b> ${STATUS_PLACEHOLDER}`);
    expect(renderStatus(template, 'IN_PROGRESS')).toContain('📊 <b>Andamento:</b> 🔄 Em andamento');
  });

  it('mostra a data anterior quando o prazo muda', () => {
    const entry = toAgendaEntry(item(), now);
    if (!entry) throw new Error('entrada esperada');
    const card = formatItemCard(entry, 'DATE_CHANGED', [
      { field: 'officialDeadline', before: '2026-10-01T23:59:00', after: '2026-10-03T23:59:00' },
    ]);
    expect(card).toContain('📅 <b>DATA ALTERADA</b>');
    expect(card).toContain('↩️ Antes: <s>qui, 01/10 · 23h59</s>');
  });

  it('avisa quando a data foi lida do texto pela IA', () => {
    const entry = toAgendaEntry(
      item({
        officialDeadline: undefined,
        metadata: { aiDueDate: '2026-10-09', aiDueEvidence: 'entrega dia 09/10' },
      }),
      now,
    );
    if (!entry) throw new Error('entrada esperada');
    const card = formatItemCard(entry, 'NEW');
    expect(card).toContain('<i>data lida do texto</i>');
    expect(card).toContain('Trecho: “entrega dia 09/10”');
  });
});

describe('demais mensagens', () => {
  it('agrupa avisos sem ação em uma única mensagem', () => {
    const [digest] = formatOtherNews([
      item({
        type: 'NOTICE',
        title: 'Aula cancelada',
        metadata: { aiSummary: 'Não haverá aula.' },
      }),
    ]);
    expect(digest).toContain('📬 <b>OUTROS AVISOS</b>');
    expect(digest).toContain('Não haverá aula.');
  });

  it('lembra às 17h só o que vence hoje', () => {
    const agenda = buildAgenda(
      [item({ title: 'Hoje', officialDeadline: '2026-10-02T23:59:00' }), item()],
      now,
    );
    const reminder = formatDueToday(agenda);
    expect(reminder).toContain('⏰ <b>AINDA HOJE</b>');
    expect(reminder).toContain('Hoje');
    expect(reminder).toContain('até 23h59');
    expect(reminder).not.toContain('Entregar AOP');
    expect(formatDueToday(buildAgenda([], now))).toBe('');
  });

  it('prepara o dia seguinte com provas, entregas e foco sugerido', () => {
    const examItem = item({
      type: 'EXAM',
      title: 'Prova P1',
      officialDeadline: undefined,
      officialDate: '2026-10-03',
      metadata: { aiStudyTopics: '["Matrizes"]' },
    });
    const agenda = buildAgenda(
      [examItem, item({ title: 'Relatório', officialDeadline: '2026-10-06T23:59:00' })],
      now,
    );
    const message = formatTomorrow(agenda, [{ itemId: examItem.id, action: 'Revisar matrizes' }]);
    expect(message).toContain('🌙 <b>AMANHÃ</b> · sábado, 03/10');
    expect(message).toContain('📝 <b>Prova amanhã</b>');
    expect(message).toContain('📖 Matrizes');
    expect(message).toContain('🎯 <b>Foco sugerido</b>');
    expect(message).toContain('Revisar matrizes');
    expect(message).toContain('🗓️ <b>Próximos dias</b>');
    expect(message).toContain('Relatório');
  });

  it('monta a semana agrupada por dia', () => {
    const agenda = buildAgenda(
      [exam(), item(), item({ title: 'Relatório', officialDeadline: '2026-10-05T23:59:00' })],
      now,
    );
    const week = formatWeek(agenda);
    expect(week).toContain('sáb, 03/10 a sex, 09/10');
    expect(week).toContain('🗓️ <b>SUA SEMANA</b>');
    expect(week).toContain('<b>sáb, 03/10</b>');
    expect(week).toContain('<b>seg, 05/10</b>');
  });
});

describe('divisão de mensagens', () => {
  it('não quebra blocos ao dividir mensagens longas', () => {
    const blocks = Array.from(
      { length: 30 },
      (_, index) => `<b>Bloco ${String(index)}</b> ${'x'.repeat(200)}`,
    );
    const messages = packBlocks('Cabeçalho', blocks, 'Continuação');
    expect(messages.length).toBeGreaterThan(1);
    for (const message of messages) {
      expect(message.length).toBeLessThanOrEqual(3_800);
      expect(message.split('<b>').length).toBe(message.split('</b>').length);
    }
    expect(messages[1]?.startsWith('Continuação')).toBe(true);
  });
});
