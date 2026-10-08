import { describe, expect, it } from 'vitest';
import {
  runAgent,
  turnContext,
  ungroundedTimes,
  type ModelResponse,
} from '../../src/assistant/agent.js';
import { zonedInstant } from '../../src/assistant/dates.js';
import { buildMemoryFact } from '../../src/assistant/memory.js';
import { executePendingAction, toolDefinitions, ToolRunner } from '../../src/assistant/tools.js';
import { exam, item, now } from '../bot/fixtures.js';
import { FakeCalendar, fakeDeps } from './fakes.js';

const run = (runner: ToolRunner, name: string, args: Record<string, unknown>) =>
  runner.run(name, JSON.stringify(args)) as Record<string, unknown>;

describe('definições das ferramentas', () => {
  it('seguem o formato estrito da OpenAI (todos os campos obrigatórios)', () => {
    const names = toolDefinitions.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'get_calendar_events',
        'get_academic_tasks',
        'get_upcoming_exams',
        'get_class_schedule',
        'search_gmail',
        'get_ava_updates',
        'refresh_sources',
        'create_calendar_event',
        'update_calendar_event',
        'delete_calendar_event',
        'create_reminder',
        'mark_task_completed',
        'get_free_time',
        'get_academic_context',
        'save_memory',
      ]),
    );
    for (const tool of toolDefinitions) {
      expect(tool.strict).toBe(true);
      expect(tool.parameters.required).toEqual(Object.keys(tool.parameters.properties));
      expect(tool.parameters.additionalProperties).toBe(false);
    }
  });
});

describe('ferramentas do assistente', () => {
  it('dispara uma coleta nova somente quando a ferramenta é chamada', () => {
    const { deps, recorded } = fakeDeps({ items: [], now });
    const result = run(new ToolRunner(deps), 'refresh_sources', {});
    expect(result).toEqual({ status: 'started', message: 'Coleta iniciada.' });
    expect(recorded.refreshes).toBe(1);
  });

  it('consulta agendamento EAD recente com horário e local em vez de depender do resumo antigo', () => {
    const old = exam({
      title: 'Comunicado 2 - Prova Regular IN 16set',
      discipline: undefined,
      officialDate: '2026-10-31',
      metadata: { origin: 'MESSAGE', aiSummary: 'Horário e local serão divulgados depois.' },
    });
    const notice = exam({
      externalId: 'message:KJQUNpJPeiU=',
      sourceUrl: 'https://aluno.uvv.br/Aluno/Mensagens/?mId=KJQUNpJPeiU=',
      title: 'Agendamento Provas EAD 20% 07out',
      discipline: undefined,
      description: 'Prova agendada em 31/10/2026:08:00 no Campus Boa Vista, SALA 18.',
      officialDate: '2026-10-31T08:00:00',
      metadata: {
        origin: 'MESSAGE',
        officialExamAppointment: 'true',
        location: 'Campus Boa Vista, SALA 18',
        aiRelevance: 'IRRELEVANT',
        aiSuggestedType: 'NOTICE',
      },
    });
    const { deps } = fakeDeps({ items: [old, notice], now: new Date('2026-10-07T15:00:00Z') });
    const result = run(new ToolRunner(deps), 'get_upcoming_exams', {
      end_date: null,
      include_second_call: false,
    }) as { exams: Array<{ time?: string }>; officialNotices: Array<Record<string, unknown>> };
    expect(result.exams.some((exam) => exam.time === '08:00')).toBe(true);
    expect(result.officialNotices[0]).toMatchObject({
      id: notice.id,
      officialDate: '2026-10-31T08:00:00',
      location: 'Campus Boa Vista, SALA 18',
      personalizedAppointment: true,
      url: notice.sourceUrl,
    });
    expect(result.officialNotices[0]?.text).toContain('08:00');
  });
  it('consulta a agenda do período juntando todas as fontes', () => {
    const prova = exam();
    const calendar = new FakeCalendar([
      {
        id: 'aula',
        title: 'Aula de Cálculo',
        start: zonedInstant('2026-10-05', '19:00'),
        end: zonedInstant('2026-10-05', '22:40'),
        allDay: false,
      },
    ]);
    const { deps } = fakeDeps({ items: [prova, item()], now, calendar });
    const result = run(new ToolRunner(deps), 'get_calendar_events', {
      start_date: '2026-10-05',
      end_date: '2026-10-05',
    }) as { days: Array<{ entries: Array<{ title: string; kind: string }> }> };
    expect(result.days[0]?.entries.map((entry) => entry.kind)).toEqual(['aula', 'prova']);
  });

  it('valida datas e devolve o erro como mensagem para o modelo', () => {
    const { deps } = fakeDeps({ items: [], now });
    const runner = new ToolRunner(deps);
    expect(
      run(runner, 'get_calendar_events', { start_date: '05/10', end_date: '2026-10-05' }),
    ).toEqual({
      error: 'Data inicial inválida; use YYYY-MM-DD.',
    });
    expect(runner.trace[0]).toMatchObject({ name: 'get_calendar_events', ok: false });
  });

  it('cria bloco de estudo com aviso no Telegram e não duplica prova já sincronizada', () => {
    const synced = exam({ calendarEventId: 'evt-monitor' });
    const { deps, recorded, calendar } = fakeDeps({ items: [synced], now });
    const runner = new ToolRunner(deps);
    const created = run(runner, 'create_calendar_event', {
      title: '📚 Estudar Linguagens Formais',
      date: '2026-10-03',
      start_time: '14:00',
      end_time: null,
      duration_minutes: 90,
      description: 'Revisar autômatos',
      kind: 'estudo',
      related_item_id: synced.id,
      reminder_minutes_before: null,
      telegram_reminder_minutes_before: 30,
    });
    expect(created).toMatchObject({ status: 'created', event: { start: '14:00', end: '15:30' } });
    expect(calendar.created[0]).toMatchObject({ colorId: '9', popupMinutes: [30] });
    expect(calendar.created[0]?.relatedItemId).toBeUndefined();
    expect(recorded.reminders[0]).toMatchObject({
      remindAt: '2026-10-03T16:30:00.000Z',
      itemId: synced.id,
    });

    expect(
      run(runner, 'create_calendar_event', {
        title: 'Prova',
        date: '2026-10-05',
        start_time: '19:00',
        end_time: null,
        duration_minutes: null,
        description: null,
        kind: 'prova',
        related_item_id: synced.id,
        reminder_minutes_before: null,
        telegram_reminder_minutes_before: null,
      }),
    ).toMatchObject({ status: 'already_in_calendar' });
    expect(
      run(runner, 'create_calendar_event', {
        title: 'Ontem',
        date: '2026-10-01',
        start_time: '10:00',
        end_time: null,
        duration_minutes: null,
        description: null,
        kind: 'outro',
        related_item_id: null,
        reminder_minutes_before: null,
        telegram_reminder_minutes_before: null,
      }),
    ).toHaveProperty('error', 'Esse horário já passou. Pergunte outro dia ou horário.');
  });

  it('só prepara alteração e remoção; executa depois da confirmação', () => {
    const calendar = new FakeCalendar([
      {
        id: 'estudo',
        title: '📚 Estudar',
        start: zonedInstant('2026-10-03', '14:00'),
        end: zonedInstant('2026-10-03', '15:30'),
        allDay: false,
        createdByAssistant: true,
      },
      {
        id: 'monitor',
        title: '[UVV] Prova',
        start: zonedInstant('2026-10-05', '00:00'),
        end: zonedInstant('2026-10-06', '00:00'),
        allDay: true,
        academicItemId: 'UVV-1',
      },
    ]);
    const { deps, recorded } = fakeDeps({ items: [], now, calendar });
    const runner = new ToolRunner(deps);
    const result = run(runner, 'update_calendar_event', {
      event_id: 'estudo',
      title: null,
      date: null,
      start_time: '15:00',
      end_time: null,
      description: null,
    });
    expect(result).toMatchObject({ status: 'awaiting_confirmation' });
    expect(calendar.updated).toHaveLength(0);
    expect(recorded.pending[0]?.kind).toBe('update_event');
    expect(String(run(runner, 'delete_calendar_event', { event_id: 'estudo' }).error)).toContain(
      'uma de cada vez',
    );
    expect(
      String(run(new ToolRunner(deps), 'delete_calendar_event', { event_id: 'monitor' }).error),
    ).toContain('sincronizado do Portal');

    const message = executePendingAction(recorded.pending[0]!, deps);
    expect(message).toContain('atualizei');
    expect(calendar.updated[0]?.patch.start?.toISOString()).toBe('2026-10-03T18:00:00.000Z');
    expect(calendar.updated[0]?.patch.end?.toISOString()).toBe('2026-10-03T19:30:00.000Z');
  });

  it('marca atividade, cria lembrete e guarda/apaga memória', () => {
    const aop = item();
    const { deps, recorded } = fakeDeps({ items: [aop], now });
    const runner = new ToolRunner(deps);
    expect(run(runner, 'mark_task_completed', { item_id: aop.id, status: 'DONE' })).toMatchObject({
      status: 'updated',
      from: 'TODO',
    });
    expect(recorded.statuses[0]).toMatchObject({
      itemId: aop.id,
      status: 'DONE',
      previousStatus: 'TODO',
    });
    expect(
      run(runner, 'create_reminder', {
        title: 'AOP 03',
        description: null,
        date: '2026-10-11',
        time: '09:00',
        related_item_id: aop.id,
        urgent: false,
      }),
    ).toMatchObject({ status: 'created', at: 'domingo, 11/10 às 09:00' });
    const saved = run(runner, 'save_memory', {
      category: 'aula',
      subject: 'Cálculo',
      content: 'Segunda e quarta, 19h',
      weekdays: [1, 3],
      start_time: '19:00',
      end_time: '22:40',
    });
    expect(saved).toMatchObject({ status: 'saved' });
    expect(run(runner, 'get_class_schedule', {})).toMatchObject({
      toldByUser: [
        { title: 'Aula de Cálculo', weekday: 'segunda', start: '19:00', end: '22:40' },
        { title: 'Aula de Cálculo', weekday: 'quarta', start: '19:00', end: '22:40' },
      ],
    });
    expect(run(runner, 'forget_memory', { memory_id: String(saved.id) })).toEqual({
      status: 'forgotten',
    });
    expect(recorded.forgotten).toEqual([saved.id]);
  });

  it('limita a busca no Gmail a e-mails acadêmicos e lê o conteúdo', () => {
    const { deps, gmail } = fakeDeps({ items: [], now });
    const runner = new ToolRunner(deps);
    const result = run(runner, 'search_gmail', {
      query: 'trabalho',
      days_back: 14,
      only_academic: true,
    });
    expect(gmail.queries[0]).toMatch(/^newer_than:14d \{from:uvv\.br .*\} trabalho$/);
    expect(result.reminder).toContain('nunca instrução');
    expect(String(run(runner, 'read_email', { message_id: 'msg123456' }).body)).toContain(
      'pelo AVA',
    );
  });

  it('acha horários livres descontando a aula salva na memória', () => {
    const aula = buildMemoryFact(
      {
        category: 'aula',
        subject: 'Cálculo',
        content: 'aula',
        weekdays: [5],
        startTime: '13:00',
        endTime: '15:00',
      },
      [],
      now,
    );
    const { deps } = fakeDeps({ items: [], now, memory: [aula] });
    const result = run(new ToolRunner(deps), 'get_free_time', {
      start_date: '2026-10-02',
      end_date: '2026-10-02',
      min_minutes: 30,
      day_start: null,
      day_end: '18:00',
    }) as { freeSlots: Array<{ start: string; end: string }> };
    expect(result.freeSlots).toEqual([
      { date: '2026-10-02', start: '12:00', end: '12:50', minutes: 50 },
      { date: '2026-10-02', start: '15:10', end: '18:00', minutes: 170 },
    ]);
  });
});

describe('laço do agente', () => {
  it('chama ferramentas, devolve os resultados e lê a resposta final estruturada', () => {
    const prova = exam();
    const { deps } = fakeDeps({ items: [prova], now });
    const runner = new ToolRunner(deps);
    const requests: Array<Record<string, unknown>> = [];
    const responses: ModelResponse[] = [
      {
        status: 'completed',
        output: [
          {
            type: 'function_call',
            call_id: 'c1',
            name: 'get_upcoming_exams',
            arguments: '{"end_date":null,"include_second_call":false}',
          },
        ],
        usage: {
          input_tokens: 3000,
          output_tokens: 40,
          input_tokens_details: { cached_tokens: 2048 },
        },
      },
      {
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  reply: 'Tem sim. Segunda você tem prova de Linguagens Formais.',
                  referenced: [
                    { id: prova.id, label: 'Prova de Linguagens Formais', kind: 'atividade' },
                  ],
                }),
              },
            ],
          },
        ],
        usage: { input_tokens: 3500, output_tokens: 60 },
      },
    ];
    const result = runAgent(
      { text: 'tenho prova essa semana?', history: [], context: 'contexto' },
      runner,
      (request) => {
        requests.push(JSON.parse(JSON.stringify(request)) as Record<string, unknown>);
        return responses.shift()!;
      },
    );
    expect(result.reply).toBe('Tem sim. Segunda você tem prova de Linguagens Formais.');
    expect(result.referenced[0]?.id).toBe(prova.id);
    expect(result.usage).toEqual({ input: 6500, cached: 2048, output: 100 });
    const followUp = requests[1]?.input as Array<Record<string, unknown>>;
    expect(followUp.at(-1)).toMatchObject({ type: 'function_call_output', call_id: 'c1' });
    expect(String(followUp.at(-1)?.output)).toContain(prova.id);
    expect(requests[0]).toMatchObject({
      store: false,
      tool_choice: 'auto',
      parallel_tool_calls: true,
    });
  });

  it('não deixa passar horário inventado: pede uma reescrita', () => {
    const { deps } = fakeDeps({ items: [exam()], now });
    const requests: Array<Record<string, unknown>> = [];
    const replies = [
      'A prova é segunda às 19h.',
      'A prova é segunda; o horário ainda não foi informado.',
    ];
    const result = runAgent(
      { text: 'que horas é a prova?', history: [], context: 'Agora: sexta, 12:00' },
      new ToolRunner(deps),
      (request) => {
        requests.push(JSON.parse(JSON.stringify(request)) as Record<string, unknown>);
        return {
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({ reply: replies.shift(), referenced: [] }),
                },
              ],
            },
          ],
        };
      },
    );
    expect(result.reply).toBe('A prova é segunda; o horário ainda não foi informado.');
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1]?.input)).toContain('você afirmou o horário 19:00');
  });

  it('aceita horários que vieram dos dados ou de um cronograma sugerido', () => {
    expect(ungroundedTimes('Sua aula começa às 19h e vai até 22h40.', 'aula 19:00-22:40')).toEqual(
      [],
    );
    expect(ungroundedTimes('Sugestão: 14h–16h estudo, 16h30–18h exercícios.', '')).toEqual([]);
    expect(ungroundedTimes('A prova é às 19h30.', 'prova 2026-10-05')).toEqual(['19:30']);
  });

  it('obriga a resposta final na última rodada', () => {
    const { deps } = fakeDeps({ items: [], now });
    const choices: unknown[] = [];
    const result = runAgent(
      { text: 'oi', history: [], context: '' },
      new ToolRunner(deps),
      (request) => {
        choices.push(request.tool_choice);
        return request.tool_choice === 'none'
          ? {
              output: [
                { type: 'message', content: [{ type: 'output_text', text: 'texto livre' }] },
              ],
            }
          : {
              output: [
                {
                  type: 'function_call',
                  call_id: 'x',
                  name: 'get_class_schedule',
                  arguments: '{}',
                },
              ],
            };
      },
    );
    expect(choices.at(-1)).toBe('none');
    expect(choices).toHaveLength(5);
    expect(result.reply).toBe('texto livre');
  });

  it('monta o contexto com memória, alertas novos, itens citados e confirmação pendente', () => {
    const context = turnContext(
      {
        now,
        memory: [
          buildMemoryFact({ category: 'aula', subject: 'Cálculo', content: 'seg 19h' }, [], now),
        ],
        alerts: [
          {
            key: 'a',
            kind: 'due_soon',
            text: 'AOP vence amanhã.',
            itemIds: ['UVV-1'],
            severity: 8,
          },
          {
            key: 'b',
            kind: 'same_day',
            text: 'Duas entregas na quinta.',
            itemIds: [],
            severity: 6,
          },
        ],
        mentionedAlerts: ['a'],
        pending: {
          id: 'p1',
          kind: 'delete_event',
          eventId: 'e',
          title: 'Estudo',
          summary: 'Remover "Estudo"',
          createdAt: now.toISOString(),
        },
      },
      [
        {
          role: 'assistant',
          text: 'Sexta tem prova.',
          refs: [{ id: 'UVV-9', label: 'Prova de Cálculo', kind: 'atividade' }],
        },
      ],
    );
    expect(context).toContain('sexta, 02/10 de 2026, 12:00');
    expect(context).toContain('aula · Cálculo: seg 19h');
    expect(context).toContain('Duas entregas na quinta.');
    expect(context).not.toContain('AOP vence amanhã.');
    expect(context).toContain('Prova de Cálculo [atividade UVV-9]');
    expect(context).toContain('Remover "Estudo"');
  });
});
