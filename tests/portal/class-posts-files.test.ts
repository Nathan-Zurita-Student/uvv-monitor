import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildClassSlots, describeClassSlots } from '../../src/portal/class-schedule.js';
import { documentKind, extractOfficeText, readDocument } from '../../src/portal/documents.js';
import {
  parseBlogTimeline,
  parseClassPostPage,
  parsePostAttachments,
} from '../../src/portal/parsers.js';

/** ZIP mínimo (deflate) para testar DOCX/PPTX/.zip sem arquivos de fixture. */
function zip(files: Record<string, string>): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = deflateRawSync(Buffer.from(content, 'utf8'));
    const nameBytes = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(Buffer.byteLength(content), 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(Buffer.byteLength(content), 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

describe('quadro de horários do Portal', () => {
  it('junta os tempos seguidos da mesma disciplina e marca EAD', () => {
    const slots = buildClassSlots(
      [
        {
          day: 'Segunda-Feira',
          entries: [
            { code: 'DESENV', title: 'Desenvolvimento Mobile', time: '19:10 ~ 20:00' },
            { code: 'DESENV', title: 'Desenvolvimento Mobile', time: '20:00 ~ 20:50' },
            { code: 'LING', title: 'Linguagens Formais e Autômatos ', time: '21:05 ~ 21:55' },
            { code: 'LING', title: 'Linguagens Formais e Autômatos ', time: '21:55 ~ 22:45' },
          ],
        },
        {
          day: 'Terça-Feira',
          entries: [
            { code: 'ASPEAD', title: '', time: '11:05 ~ 11:55' },
            { code: 'ASPEAD', title: '', time: '11:55 ~ 12:45' },
          ],
        },
        { day: 'Sábado', entries: [{ code: '-', title: '', time: '' }] },
      ],
      '2026/2',
      { ASPEAD: 'Administração e Aspectos Legais' },
    );
    expect(slots).toEqual([
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
    ]);
    expect(describeClassSlots(slots)).toContain('Segunda: Desenvolvimento Mobile 19:10–20:50');
  });
});

describe('mural da turma e arquivos dos posts', () => {
  const now = new Date('2026-10-05T15:00:00-03:00');

  it('lê posts, datas e texto do mural (inclusive do ano anterior)', () => {
    const html = `<ul class="timeline">
      <li class="timeline-inverted"><div class="timeline-date">04 <p>out</p></div>
        <div class="panel"><div class="panel-heading"><h3 class="panel-title">Prof de atestado: n&#227;o haver&#225; aula</h3></div>
        <div class="panel-body"><p>Bom dia Pessoal,</p><a href="/Aluno/Post/15fdTaiGwMU=" class="btn">Visualizar Post</a></div></div></li>
      <li class="timeline-inverted"><div class="timeline-date">20 <p>dez</p></div>
        <div class="panel"><div class="panel-heading"><h3 class="panel-title">Antigo</h3></div>
        <div class="panel-body"><a href="/Aluno/Post/abc=">Visualizar Post</a></div></div></li>
    </ul>`;
    expect(parseBlogTimeline(html, now)).toEqual([
      {
        postId: '15fdTaiGwMU=',
        title: 'Prof de atestado: não haverá aula',
        publishedOn: '2026-10-04',
        text: 'Bom dia Pessoal,',
      },
      { postId: 'abc=', title: 'Antigo', publishedOn: '2025-12-20', text: '' },
    ]);
  });

  it('pega o botão "Baixar Arquivo" e a data de publicação no post', () => {
    expect(
      parsePostAttachments([
        { text: 'Unidade_03.pdf', href: '/Aluno/BaixarArquivoPost?aId=NTU1MjEw&pId=858011' },
        { text: 'outro link', href: 'https://enquetes.ufes.br/x' },
      ]),
    ).toEqual([
      {
        id: 'NTU1MjEw',
        name: 'Unidade_03.pdf',
        url: 'https://aluno.uvv.br/Aluno/BaixarArquivoPost?aId=NTU1MjEw&pId=858011',
      },
    ]);
    const item = parseClassPostPage({
      url: 'https://aluno.uvv.br/Aluno/Post/Pi4IhmU1ucY=',
      discipline: 'Cálculo Numérico Computacional',
      headings: ['Unidade 03', 'Wanderson Muniz de Santana'],
      bodyText: 'Segue material da Unidade 03. Bom estudo!',
      pageText: '',
      links: [],
      attachments: [
        {
          text: 'Unidade_03.pdf',
          href: 'https://aluno.uvv.br/Aluno/BaixarArquivoPost?aId=NTU1MjEw&pId=858011',
        },
      ],
      publishedOn: '2026-09-21',
      referenceYear: 2026,
    });
    expect(JSON.parse(item.metadata.attachments ?? '[]')).toEqual([
      expect.objectContaining({ id: 'NTU1MjEw', name: 'Unidade_03.pdf' }),
    ]);
    expect(item.metadata.receivedAt).toBe('2026-09-21T12:00:00-03:00');
    expect(item.links).toContain(
      'https://aluno.uvv.br/Aluno/BaixarArquivoPost?aId=NTU1MjEw&pId=858011',
    );
  });

  it('extrai texto de DOCX, PPTX e de dentro de .zip; imagem não é lida', async () => {
    const docx = zip({
      'word/document.xml':
        '<w:document><w:body><w:p><w:r><w:t>Lista de AFND</w:t></w:r></w:p><w:p><w:r><w:t>Questão 1 &amp; 2</w:t></w:r></w:p></w:body></w:document>',
    });
    expect(extractOfficeText(docx, 'Lista.docx').text).toBe('Lista de AFND\nQuestão 1 & 2');
    const pptx = zip({
      'ppt/slides/slide2.xml': '<p:sld><a:p><a:t>Segundo</a:t></a:p></p:sld>',
      'ppt/slides/slide1.xml': '<p:sld><a:p><a:t>Primeiro</a:t></a:p></p:sld>',
    });
    expect(extractOfficeText(pptx, 'Aula.pptx')).toEqual({
      pages: 2,
      text: 'Slide 1\nPrimeiro\n\nSlide 2\nSegundo',
    });
    const archive = zip({
      '__MACOSX/._enunciado.txt': 'lixo',
      'trabalho/enunciado.txt': 'Implementar um AFD que reconhece números pares.',
      'trabalho/foto.png': 'binário',
    });
    const read = await readDocument(archive, 'Trabalho_2026-2.zip', 'application/x-zip-compressed');
    expect(read.status).toBe('lido');
    expect(read.text).toContain('### trabalho/enunciado.txt');
    expect(read.text).toContain('números pares');
    expect(read.text).not.toContain('lixo');
    expect(await readDocument(new Uint8Array([1, 2, 3]), 'IMG_5330.png', '')).toMatchObject({
      status: 'imagem',
      text: '',
    });
    expect(documentKind('Unidade_03.pdf', 'application/octet-stream')).toBe('pdf');
  });
});
