import { describe, expect, it } from 'vitest';
import { dueDigestSlot, renderDailyDigest } from '../../src/bot/daily-digest.js';
import { createRenderContext } from '../../src/bot/screens.js';
import { item, exam } from './fixtures.js';

describe('conteúdo do resumo periódico', () => {
  const at = (time: string) => new Date(`2026-10-07T${time}:00-03:00`);
  it('nunca envia antes, usa São Paulo e recupera atraso de até uma hora', () => {
    expect(dueDigestSlot(at('11:59'), () => false)).toBeUndefined();
    expect(dueDigestSlot(at('12:00'), () => false)).toBe('12:00');
    expect(dueDigestSlot(at('12:59'), () => false)).toBe('12:00');
    expect(dueDigestSlot(at('13:00'), () => false)).toBeUndefined();
    expect(dueDigestSlot(at('18:00'), (key) => key === '2026-10-07 18:00')).toBeUndefined();
    expect(dueDigestSlot(at('20:00'), () => false)).toBe('20:00');
    expect(dueDigestSlot(at('21:00'), () => false)).toBe('21:00');
    expect(dueDigestSlot(at('23:59'), () => false)).toBe('23:00');
  });

  it('inclui links, andamento e exclui concluídos/ignorados', () => {
    const context = createRenderContext({
      now: at('12:00'),
      lastSyncAt: at('11:55').toISOString(),
      items: [
        item({
          title: 'Trabalho pendente',
          officialDeadline: '2026-10-08T23:59:00',
          status: 'IN_PROGRESS',
        }),
        item({ title: 'Já concluí', officialDeadline: '2026-10-08', status: 'DONE' }),
        exam({ title: 'Ignorada', officialDate: '2026-10-08', status: 'IGNORED' }),
      ],
    });
    const result = renderDailyDigest(context, '12:00', {
      portal: 'SUCCESS',
      gmail: 'SUCCESS',
      calendar: 'SUCCESS',
    });
    expect(result.text).toContain('Trabalho pendente');
    expect(result.text).toContain('Em andamento');
    expect(result.text).toContain('href="https://');
    expect(result.text).not.toContain('Já concluí');
    expect(result.text).not.toContain('Ignorada');
    expect(result.text).not.toContain('dados anteriores');
    expect(result.keyboard.length).toBe(3);
  });

  it('avisa fontes incompletas e nunca chama memória antiga de informação verificada agora', () => {
    const context = createRenderContext({
      now: at('18:00'),
      lastSyncAt: '2026-10-06T23:00:00Z',
      items: [],
    });
    const result = renderDailyDigest(context, '18:00', {
      portal: 'PARTIAL',
      gmail: 'FAILED',
      calendar: 'SUCCESS',
    });
    expect(result.text).toContain('dados anteriores');
    expect(result.text).toContain('Portal/AVA verificado parcialmente');
    expect(result.text).toContain('Gmail não verificado');
    expect(result.text).toContain('Nenhuma prova ou entrega pendente encontrada');
  });

  it('escapa aspas em links sem permitir atributos HTML injetados', () => {
    const context = createRenderContext({
      now: at('12:00'),
      items: [item({ officialDeadline: '2026-10-08', sourceUrl: 'https://aluno.uvv.br/?q="bad"' })],
    });
    const result = renderDailyDigest(context, '12:00');
    expect(result.text).toContain('q=&quot;bad&quot;');
    expect(result.text).not.toContain('q="bad"');
  });

  it('mantém HTML íntegro e abaixo do limite mesmo com texto expandido pelo escape', () => {
    const context = createRenderContext({
      now: at('12:00'),
      items: Array.from({ length: 3 }, (_, n) =>
        item({
          id: `UVV-${n}`,
          title: 'x&'.repeat(100),
          discipline: 'x&'.repeat(100),
          officialDeadline: '2026-10-08',
          sourceUrl: `https://aluno.uvv.br/${'&'.repeat(200)}`,
          metadata: { location: 'x&'.repeat(150) },
        }),
      ),
    });
    const result = renderDailyDigest(context, '12:00');
    expect(result.text.length).toBeLessThan(3800);
    expect(result.text.match(/<b>/g)?.length).toBe(result.text.match(/<\/b>/g)?.length);
    expect(result.text).toContain('compromisso(s) no painel');
  });

  it('faz revisão de sete dias na quarta, mas no dia seguinte só três dias', () => {
    const task = item({ title: 'Entrega de segunda', officialDeadline: '2026-10-12' });
    const context = createRenderContext({ now: at('20:00'), items: [task] });
    expect(renderDailyDigest(context, '20:00').text).toContain('Entrega de segunda');
    const thursday = { ...context, now: new Date('2026-10-08T20:00:00-03:00') };
    // Recalcular a agenda com o novo dia, como no serviço real.
    expect(
      renderDailyDigest(createRenderContext({ now: thursday.now, items: [task] }), '20:00').text,
    ).not.toContain('Entrega de segunda');
  });

  it('não deixa três pendências antigas esconderem uma prova próxima', () => {
    const context = createRenderContext({
      now: at('12:00'),
      items: [
        ...Array.from({ length: 3 }, (_, n) =>
          item({ id: `UVV-OLD${n}`, title: `Antiga ${n}`, officialDeadline: '2026-09-20' }),
        ),
        exam({ title: 'Prova de amanhã', officialDate: '2026-10-08T08:00:00' }),
      ],
    });
    const result = renderDailyDigest(context, '12:00');
    expect(result.text).toContain('Prova de Linguagens Formais');
    expect(result.text.indexOf('Prova de Linguagens Formais')).toBeLessThan(
      result.text.indexOf('Antiga 0'),
    );
  });
});
