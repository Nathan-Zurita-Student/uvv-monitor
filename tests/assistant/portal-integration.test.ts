import { describe, expect, it } from 'vitest';
import { buildAgenda } from '../../src/agenda/agenda.js';
import {
  classCancellations,
  classesTodayText,
  classWeeklySlots,
} from '../../src/assistant/classes.js';
import { buildTimeline, busyIntervals } from '../../src/assistant/timeline.js';
import { ToolRunner } from '../../src/assistant/tools.js';
import type { ClassSlot } from '../../src/models/class-schedule.js';
import type { PortalDocument } from '../../src/models/portal-document.js';
import { exam, item } from '../bot/fixtures.js';
import { fakeDeps } from './fakes.js';

const now = new Date('2026-10-04T10:00:00-03:00');
const classes: ClassSlot[] = [
  {
    code: 'DESENV',
    discipline: 'Desenvolvimento Mobile',
    weekday: 1,
    startTime: '19:10',
    endTime: '20:50',
    online: false,
    period: '2026/2',
  },
  {
    code: 'LING',
    discipline: 'Linguagens Formais e Autômatos',
    weekday: 1,
    startTime: '21:05',
    endTime: '22:45',
    online: false,
    period: '2026/2',
  },
  {
    code: 'ASPEAD',
    discipline: 'Administração e Aspectos Legais',
    weekday: 2,
    startTime: '11:05',
    endTime: '12:45',
    online: true,
    period: '2026/2',
  },
];
const atestado = item({
  id: 'UVV-AVISO1',
  externalId: 'post:15fdTaiGwMU=',
  discipline: 'Desenvolvimento Mobile',
  title:
    'Prof Saulo de atestado até amanhã. Logo não haverá aula de Mobile amanhã dia 05/10 para turma CC6N',
  description: 'Então amanhã não haverá aula de Mobile a noite no primeiro tempo 19:10.',
  type: 'NOTICE',
  officialDeadline: undefined,
  status: 'WAITING',
  metadata: { origin: 'CLASS_POST', receivedAt: '2026-10-04T12:00:00-03:00' },
});

function documents(): PortalDocument[] {
  return [
    {
      id: 'doc:U3',
      postExternalId: 'post:Pi4IhmU1ucY=',
      discipline: 'Cálculo Numérico Computacional',
      postTitle: 'Unidade 03',
      publishedOn: '2026-09-21',
      fileName: 'Unidade_03.pdf',
      url: 'https://aluno.uvv.br/Aluno/BaixarArquivoPost?aId=U3',
      contentType: 'application/pdf',
      sizeBytes: 100,
      sha256: 'a',
      pages: 57,
      status: 'lido',
      fetchedAt: now.toISOString(),
      telegramFileId: 'file-u3',
      sentAt: now.toISOString(),
    },
    {
      id: 'doc:M1',
      postExternalId: 'post:mob',
      discipline: 'Desenvolvimento Mobile',
      postTitle: 'Atividade Biblioteca',
      publishedOn: '2026-09-14',
      fileName: 'Atividade_Biblioteca_Mobile_ALUNO.pdf',
      url: 'https://aluno.uvv.br/Aluno/BaixarArquivoPost?aId=M1',
      contentType: 'application/pdf',
      sizeBytes: 100,
      sha256: 'b',
      pages: 10,
      status: 'lido',
      fetchedAt: now.toISOString(),
      telegramFileId: 'file-m1',
      sentAt: now.toISOString(),
    },
  ];
}

describe('quadro de horários e avisos de aula cancelada', () => {
  it('lê o aviso "não haverá aula amanhã dia 05/10" e risca a aula daquele dia', () => {
    const cancellations = classCancellations([atestado], now);
    expect(cancellations).toEqual([
      expect.objectContaining({ discipline: 'Desenvolvimento Mobile', date: '2026-10-05' }),
    ]);
    const timeline = buildTimeline({
      from: '2026-10-05',
      to: '2026-10-06',
      now,
      agenda: buildAgenda([], now),
      slots: classWeeklySlots(classes),
      cancellations,
    });
    expect(
      timeline.map((entry) => `${entry.date} ${entry.start} ${entry.title} ${entry.status ?? ''}`),
    ).toEqual([
      '2026-10-05 19:10 Aula de Desenvolvimento Mobile cancelada',
      '2026-10-05 21:05 Aula de Linguagens Formais e Autômatos ',
    ]);
    // EAD não aparece como aula presencial e a aula cancelada não ocupa horário.
    expect(busyIntervals(timeline)).toHaveLength(1);
    expect(classesTodayText(classes, cancellations, new Date('2026-10-05T08:00:00-03:00'))).toBe(
      'Desenvolvimento Mobile 19:10–20:50 (cancelada: "Prof Saulo de atestado até amanhã. Logo não haverá aula de Mobile amanhã dia 05/10 para turma CC6N"); Linguagens Formais e Autômatos 21:05–22:45',
    );
  });

  it('prova sem hora ganha o horário provável da aula da disciplina', () => {
    const prova = exam({ officialDate: '2026-10-05' });
    const timeline = buildTimeline({
      from: '2026-10-05',
      to: '2026-10-05',
      now,
      agenda: buildAgenda([prova], now),
      slots: classWeeklySlots(classes),
      listSlots: false,
    });
    expect(timeline).toEqual([
      expect.objectContaining({ kind: 'prova', probableStart: '21:05', probableEnd: '22:45' }),
    ]);
  });
});

describe('arquivos dos professores no assistente', () => {
  it('visão da matéria, leitura do material e envio do arquivo', () => {
    const sent: Array<Array<{ fileId: string; caption?: string }>> = [];
    const files = documents();
    const post = item({
      id: 'UVV-POST01',
      externalId: 'post:Pi4IhmU1ucY=',
      discipline: 'Cálculo Numérico Computacional',
      title: 'Unidade 03',
      description: 'Segue material da Unidade 03.',
      type: 'NOTICE',
      officialDeadline: undefined,
      metadata: {
        origin: 'CLASS_POST',
        professor: 'Wanderson Muniz de Santana',
        receivedAt: '2026-09-21T12:00:00-03:00',
        attachments: JSON.stringify([{ id: 'U3', name: 'Unidade_03.pdf', url: 'x' }]),
      },
    });
    const { deps } = fakeDeps({
      now,
      items: [post, atestado],
      classes,
      documents: {
        list: () => files,
        send: (selection) => sent.push(selection),
      },
    });
    const runner = new ToolRunner(deps);
    const call = (name: string, args: Record<string, unknown>) =>
      runner.run(name, JSON.stringify(args)) as Record<string, unknown>;

    expect(call('get_discipline_overview', { discipline: 'calculo' })).toMatchObject({
      discipline: 'Cálculo Numérico Computacional',
      professors: ['Wanderson Muniz de Santana'],
      recentPosts: [expect.objectContaining({ id: 'UVV-POST01', attachments: ['Unidade_03.pdf'] })],
      files: [expect.objectContaining({ id: 'doc:U3', name: 'Unidade_03.pdf' })],
    });
    expect(call('get_discipline_overview', { discipline: 'mobile' })).toMatchObject({
      classTimes: [{ weekday: 'segunda', start: '19:10', end: '20:50' }],
      cancelledClasses: [expect.objectContaining({ notice: atestado.title })],
    });
    expect(call('read_academic_item', { item_id: 'UVV-POST01' })).toMatchObject({
      text: 'Segue material da Unidade 03.',
      attachments: [expect.objectContaining({ id: 'doc:U3', sentToChat: true })],
    });
    expect(
      call('send_class_files', {
        document_id: null,
        query: 'unidade 03',
        discipline: null,
        limit: null,
      }),
    ).toMatchObject({ sent: [{ name: 'Unidade_03.pdf' }] });
    expect(sent).toEqual([[{ fileId: 'file-u3', caption: 'Unidade 03 · 21/09' }]]);
    const schedule = call('get_class_schedule', {});
    expect(schedule.period).toBe('2026/2');
    expect(schedule.officialSchedule).toContainEqual({
      weekday: 'terça',
      discipline: 'Administração e Aspectos Legais',
      start: '11:05',
      end: '12:45',
      ead: true,
      note: 'EAD: horário de referência do quadro, sem aula presencial',
    });
  });
});
