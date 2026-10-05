import { createHash } from 'node:crypto';
import type { Page, Response } from 'playwright';
import type { ClassSlot } from '../models/class-schedule.js';
import { documentIdFor } from '../models/portal-document.js';
import { parseMoodleActivity, type MoodleActivityInput } from '../moodle/activity-parser.js';
import { logger } from '../utils/logger.js';
import { buildClassSlots } from './class-schedule.js';
import { PORTAL_URLS } from './constants.js';
import type { DownloadedDocument } from '../telegram/portal-files.js';
import { parseExamSchedulePdf } from './exam-schedule.js';
import type { ClassCardInput, ClassPostPageInput, MessageLinkInput, PortalItem } from './models.js';
import {
  parseBlogTimeline,
  parseCalendarResponse,
  parseClassCards,
  parseClassPostPage,
  extractPortalDates,
  inferItemType,
  parseMessageLinks,
  parseWorkflowResponse,
  type BlogTimelineEntry,
  type PostAttachment,
} from './parsers.js';

async function navigate(page: Page, url: string): Promise<void> {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (response && response.status() >= 400) {
    throw new Error(`Portal respondeu com HTTP ${response.status()} em ${url}`);
  }
  await page.waitForLoadState('networkidle').catch(() => undefined);
}

async function responseJson(response: Response): Promise<unknown> {
  return (await response.json()) as unknown;
}

export async function collectMessages(page: Page): Promise<PortalItem[]> {
  await navigate(page, PORTAL_URLS.messages);
  const inputs: MessageLinkInput[] = await page
    .locator('a[href*="/Aluno/Mensagens/?mId="]')
    .evaluateAll((links) =>
      links.map((link) => ({
        text: link.textContent ?? '',
        href: (link as HTMLAnchorElement).href,
      })),
    );
  const summaries = parseMessageLinks(inputs);
  await navigate(page, PORTAL_URLS.classes);
  const enrolledClasses = new Map<string, Set<string>>();
  for (const heading of await page.locator('.card-turma-head').allTextContents()) {
    const classLine = heading
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => /\b[A-Z]{1,3}\d+[A-Za-z.]?\s*-/i.test(line));
    const match = classLine ? /^([A-Z]{1,3}\d+[A-Za-z.]?)\s*-\s*(.+)$/i.exec(classLine) : null;
    if (!match?.[1] || !match[2]) continue;
    const cohort = match[1].replace(/\.$/, '').toUpperCase();
    const disciplines = enrolledClasses.get(cohort) ?? new Set<string>();
    disciplines.add(match[2].trim());
    enrolledClasses.set(cohort, disciplines);
  }
  const referenceYear = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
    }).format(new Date()),
  );
  const results: PortalItem[] = [];
  for (const summary of summaries) {
    await navigate(page, summary.sourceUrl);
    const panels = (await page.locator('.box-mensagens, .panel-body').allTextContents())
      .map((text) => text.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const body = panels.sort((left, right) => right.length - left.length)[0] ?? summary.description;
    const links = await page
      .locator('.box-mensagens a[href], .panel-body a[href]')
      .evaluateAll((elements) =>
        elements.map((link) => ({
          text: link.textContent ?? '',
          href: (link as HTMLAnchorElement).href,
        })),
      );
    const type = inferItemType(`${summary.title} ${body}`);
    results.push({
      ...summary,
      description: body,
      type,
      ...extractPortalDates(`${summary.title} ${body}`, type, referenceYear),
      links: [summary.sourceUrl, ...links.map((link) => link.href)],
      metadata: { ...summary.metadata, relatedLinks: JSON.stringify(links) },
    });

    if (!/calend[aá]rio\s+de\s+provas/i.test(summary.title)) continue;
    const documentLink = links.find((link) => /sharepoint\.com/i.test(link.href));
    if (!documentLink) continue;
    try {
      const pdfResponse = page.waitForResponse(
        async (response) =>
          (await response.allHeaders())['content-type']
            ?.toLowerCase()
            .includes('application/pdf') ?? false,
        { timeout: 60_000 },
      );
      await navigate(page, documentLink.href);
      const response = await pdfResponse;
      results.push(
        ...(await parseExamSchedulePdf(
          new Uint8Array(await response.body()),
          enrolledClasses,
          referenceYear,
          summary.sourceUrl,
          documentLink.href,
        )),
      );
    } catch (error) {
      // Mantém o comunicado coletado. A próxima execução tentará novamente o anexo.
      logger.warn(
        {
          module: 'Portal',
          source: 'Calendário oficial de provas',
          error: error instanceof Error ? error.message : 'erro desconhecido',
        },
        'Não foi possível interpretar o anexo de provas',
      );
    }
  }
  return results;
}

/** O mural entrega 3 posts por página no "Carregar mais…". */
const MAX_BLOG_PAGES = 20;
/** Posts abertos por coleta (os mais recentes primeiro). */
const MAX_POSTS_PER_RUN = 150;

function localYear(now: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric' }).format(
      now,
    ),
  );
}

/** Todos os posts do mural de uma turma, seguindo o "Carregar mais…" até acabar. */
async function blogTimeline(page: Page, blogUrl: string, now: Date): Promise<BlogTimelineEntry[]> {
  const parametros = new URL(blogUrl).searchParams.get('parametros');
  const entries: BlogTimelineEntry[] = [];
  if (parametros) {
    for (let pageNumber = 0; pageNumber < MAX_BLOG_PAGES; pageNumber += 1) {
      // O próprio Portal codifica o parâmetro duas vezes nessa chamada.
      const url = `${PORTAL_URLS.base}Aluno/BlogCarregarMais/?parametros=${encodeURIComponent(
        encodeURIComponent(parametros),
      )}&pageSize=3&pageNumber=${String(pageNumber)}&filter=&ano=${String(localYear(now))}`;
      const response = await page.request.get(url);
      if (!response.ok()) break;
      const pageEntries = parseBlogTimeline(await response.text(), now).filter(
        (entry) => !entries.some((known) => known.postId === entry.postId),
      );
      if (pageEntries.length === 0) break;
      entries.push(...pageEntries);
    }
  }
  if (entries.length > 0) return entries;
  // Sem a paginação, lê ao menos os posts que a página do mural mostra.
  await navigate(page, blogUrl);
  return parseBlogTimeline(await page.content(), now);
}

export async function collectClassPosts(page: Page, now = new Date()): Promise<PortalItem[]> {
  await navigate(page, PORTAL_URLS.classes);
  const cards: Array<ClassCardInput & { blogUrls: string[] }> = await page
    .locator('.card-turma')
    .evaluateAll((elements) =>
      elements.map((card) => ({
        heading:
          card.querySelector('.card-turma-head')?.textContent ??
          card.querySelector('h1,h2,h3,h4,strong')?.textContent ??
          '',
        text: card.textContent ?? '',
        links: Array.from(card.querySelectorAll('a[href*="/Aluno/Post/"]')).map((link) => ({
          text: link.textContent ?? '',
          href: (link as HTMLAnchorElement).href,
        })),
        blogUrls: Array.from(card.querySelectorAll('a[href*="/Aluno/Blog/"]')).map(
          (link) => (link as HTMLAnchorElement).href,
        ),
      })),
    );
  const summaries = parseClassCards(cards);
  const postKey = (url: string) => /\/Aluno\/Post\/([^/?#]+)/i.exec(url)?.[1] ?? url;
  const targets = new Map<string, { url: string; discipline: string; publishedOn?: string }>(
    summaries.map((item) => [
      postKey(item.sourceUrl),
      { url: item.sourceUrl, discipline: item.discipline ?? '' },
    ]),
  );

  for (const card of cards) {
    for (const blogUrl of [...new Set(card.blogUrls)]) {
      for (const entry of await blogTimeline(page, blogUrl, now)) {
        targets.set(entry.postId, {
          url: `${PORTAL_URLS.base}Aluno/Post/${entry.postId}`,
          discipline: card.heading,
          ...(entry.publishedOn ? { publishedOn: entry.publishedOn } : {}),
        });
      }
    }
  }

  const referenceYear = localYear(now);
  const items: PortalItem[] = [];
  const ordered = [...targets.values()]
    .sort((left, right) => (right.publishedOn ?? '9999').localeCompare(left.publishedOn ?? '9999'))
    .slice(0, MAX_POSTS_PER_RUN);
  for (const target of ordered) {
    await navigate(page, target.url);
    const panels = (await page.locator('.panel-body').allTextContents())
      .map((text) => text.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const bodyText = panels.sort((left, right) => right.length - left.length)[0] ?? '';
    const breadcrumbDisciplines = (await page.locator('a[href*="/Aluno/Blog/"]').allTextContents())
      .map((text) => text.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .sort((left, right) => left.length - right.length);
    const input: ClassPostPageInput = {
      url: target.url,
      discipline: breadcrumbDisciplines[0] ?? target.discipline,
      headings: await page.locator('h1,h2,h3,h4,.panel-title').allTextContents(),
      bodyText,
      pageText: await page.locator('body').innerText(),
      links: await page.locator('.panel-body a[href]').evaluateAll((links) =>
        links.map((link) => ({
          text: link.textContent ?? '',
          href: (link as HTMLAnchorElement).href,
        })),
      ),
      // O botão "Baixar Arquivo" fica fora do texto do post.
      attachments: await page.locator('a[href*="BaixarArquivoPost"]').evaluateAll((links) =>
        links.map((link) => ({
          text: link.getAttribute('title') || link.textContent || '',
          href: (link as HTMLAnchorElement).href,
        })),
      ),
      ...(target.publishedOn ? { publishedOn: target.publishedOn } : {}),
      referenceYear,
    };
    items.push(parseClassPostPage(input));
  }
  return items;
}

/** Quadro de Horários: uma coluna por dia, cada tempo de aula com sigla, disciplina e horário. */
export async function collectClassSchedule(page: Page): Promise<ClassSlot[]> {
  await navigate(page, PORTAL_URLS.schedule);
  const data = await page.evaluate(() => {
    const grid = document.querySelector('.conteudo-body.text-center') ?? document.body;
    const columns = Array.from(grid.children).flatMap((column) => {
      const day = column.querySelector('b')?.textContent ?? '';
      const entries = Array.from(column.querySelectorAll('.schedule-item')).map((item) => ({
        code: item.querySelector('b')?.textContent ?? '',
        title: item.getAttribute('data-original-title') || item.getAttribute('title') || '',
        time: item.querySelector('span')?.textContent ?? item.textContent ?? '',
      }));
      return day ? [{ day, entries }] : [];
    });
    const legend: Record<string, string> = {};
    for (const line of Array.from(document.querySelectorAll('.panel-body li'))) {
      const [code, ...name] = (line.textContent ?? '').split(':');
      if (code && name.length > 0) legend[code.trim()] = name.join(':').trim();
    }
    const period = document.querySelector('.cabecalho-conteudo h3 small')?.textContent ?? '';
    return { columns, legend, period };
  });
  return buildClassSlots(data.columns, data.period, data.legend);
}

/** Downloads por coleta (a primeira coleta pega o histórico em duas ou três execuções). */
const MAX_DOWNLOADS_PER_RUN = 40;
const MAX_DOCUMENT_BYTES = 45 * 1024 * 1024;

/**
 * Baixa os arquivos anexados aos posts que ainda não foram enviados ao Telegram. Usa a sessão do
 * Portal já aberta (o download exige login); nada é salvo em disco nem lido: o conteúdo segue em
 * memória só até o envio.
 */
export async function downloadPostDocuments(
  page: Page,
  items: PortalItem[],
  known: ReadonlySet<string>,
  now = new Date(),
): Promise<DownloadedDocument[]> {
  const pending: Array<{ item: PortalItem; attachment: PostAttachment }> = [];
  for (const item of items) {
    if (item.origin !== 'CLASS_POST' || !item.metadata.attachments) continue;
    let attachments: PostAttachment[];
    try {
      attachments = JSON.parse(item.metadata.attachments) as PostAttachment[];
    } catch {
      continue;
    }
    for (const attachment of attachments) {
      const id = documentIdFor(attachment.id);
      if (known.has(id) || pending.some((entry) => documentIdFor(entry.attachment.id) === id))
        continue;
      pending.push({ item, attachment });
    }
  }

  const documents: DownloadedDocument[] = [];
  for (const { item, attachment } of pending.slice(0, MAX_DOWNLOADS_PER_RUN)) {
    const base = {
      id: documentIdFor(attachment.id),
      postExternalId: item.externalId,
      discipline: item.discipline ?? '',
      postTitle: item.title,
      publishedOn: (item.metadata.receivedAt ?? '').slice(0, 10),
      fileName: attachment.name,
      url: attachment.url,
      fetchedAt: now.toISOString(),
      telegramFileId: '',
      sentAt: '',
    };
    try {
      const response = await page.request.get(attachment.url, { timeout: 90_000 });
      if (!response.ok()) throw new Error(`HTTP ${String(response.status())}`);
      const contentType = response.headers()['content-type'] ?? '';
      const length = Number(response.headers()['content-length'] ?? 0);
      if (length > MAX_DOCUMENT_BYTES) {
        documents.push({
          ...base,
          contentType,
          sizeBytes: length,
          sha256: '',
          pages: 0,
          status: 'grande demais',
        });
        continue;
      }
      const bytes = new Uint8Array(await response.body());
      const tooBig = bytes.length > MAX_DOCUMENT_BYTES;
      documents.push({
        ...base,
        contentType,
        sizeBytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        pages: 0,
        status: tooBig ? 'grande demais' : 'baixado',
        ...(tooBig ? {} : { bytes }),
      });
    } catch (error) {
      documents.push({
        ...base,
        contentType: '',
        sizeBytes: 0,
        sha256: '',
        pages: 0,
        status: `erro: ${error instanceof Error ? error.message.slice(0, 120) : 'desconhecido'}`,
      });
    }
  }
  return documents;
}

export async function collectEadActivities(page: Page): Promise<PortalItem[]> {
  await navigate(page, PORTAL_URLS.classes);
  const accessLinks = page.locator(
    '.card-turma a[data-content][data-url*="saladeaula.ead.uvv.br"]',
  );
  const courseCount = await accessLinks.count();
  if (courseCount === 0) return [];

  // O botão oficial não usa /Aluno/Link. A interface atual chama
  // /AcessoMoodle/GetToken e conclui o SSO de forma assíncrona. Clicar no
  // controle real preserva esse contrato sem armazenar cookies ou tokens.
  await accessLinks.first().click();
  await page.waitForURL((url) => url.hostname === 'saladeaula.ead.uvv.br', {
    timeout: 60_000,
    waitUntil: 'domcontentloaded',
  });
  await navigate(page, PORTAL_URLS.eadCourses);
  if (
    new URL(page.url()).hostname !== 'saladeaula.ead.uvv.br' ||
    (await page.locator('input[name="username"],input[name="password"]').count()) > 0
  ) {
    throw new Error('SSO abriu, mas o Ambiente Virtual não confirmou uma sessão autenticada.');
  }

  const courseUrls = await page
    .locator('a[href*="/course/view.php?id="]')
    .evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).href));
  const uniqueCourses = new Set(
    courseUrls.map(
      (url) =>
        new URL(url).origin +
        new URL(url).pathname +
        `?id=${new URL(url).searchParams.get('id') ?? ''}`,
    ),
  );
  const items: PortalItem[] = [];
  const seenActivities = new Set<string>();
  for (const courseUrl of uniqueCourses) {
    await navigate(page, courseUrl);
    const courseTitle =
      (await page.locator('h1').first().textContent())?.replace(/\s+/g, ' ').trim() ??
      'Disciplina EAD';
    const sectionUrls = await page
      .locator('a[href*="/course/view.php?id="][href*="section="]')
      .evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).href));
    const targets = new Set(sectionUrls.length > 0 ? sectionUrls : [courseUrl]);
    for (const target of targets) {
      await navigate(page, target);
      const activities: MoodleActivityInput[] = await page
        .locator('[role="main"] li.activity')
        .evaluateAll(
          (elements, title) =>
            elements.flatMap((element) => {
              const link = element.querySelector<HTMLAnchorElement>(
                'a[href*="/mod/"][href*="view.php?id="]',
              );
              if (!link) return [];
              const instance = link.querySelector('.instancename');
              const activityTitle = instance?.childNodes[0]?.textContent ?? link.textContent ?? '';
              const completion =
                element.querySelector<HTMLElement>('[data-region="completion-info"] button')
                  ?.innerText ??
                element
                  .querySelector<HTMLElement>('[data-region="completion-info"] [aria-label]')
                  ?.getAttribute('aria-label') ??
                element.querySelector<HTMLElement>('button')?.innerText ??
                '';
              return [
                {
                  courseTitle: title,
                  title: activityTitle,
                  url: link.href,
                  text: (element as HTMLElement).innerText,
                  completion,
                },
              ];
            }),
          courseTitle,
        );
      for (const input of activities) {
        const item = parseMoodleActivity(input);
        if (!item || seenActivities.has(item.externalId)) continue;
        seenActivities.add(item.externalId);
        item.metadata.moodleCourseUrl = courseUrl;
        items.push(item);
      }
    }
  }
  return items;
}

export async function collectServiceHistory(page: Page): Promise<PortalItem[]> {
  const responsePromise = page.waitForResponse(
    (response) => response.url().includes('/Ajax/GetWorkflowHistory') && response.status() === 200,
  );
  await navigate(page, PORTAL_URLS.service);
  return parseWorkflowResponse(await responseJson(await responsePromise));
}

export async function collectCalendarEvents(page: Page): Promise<PortalItem[]> {
  const responsePromise = page.waitForResponse(
    (response) => response.url().includes('/Calendario/ObterEventos') && response.status() === 200,
  );
  await navigate(page, PORTAL_URLS.calendar);
  return parseCalendarResponse(await responseJson(await responsePromise));
}

export async function collectRegularSchedule(page: Page): Promise<PortalItem[]> {
  await navigate(page, PORTAL_URLS.schedule);
  const panels = await page.locator('.panel').allTextContents();
  return panels
    .map((text) => text.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((text, index) => ({
      externalId: `schedule:panel:${index}`,
      origin: 'SCHEDULE' as const,
      sourceUrl: PORTAL_URLS.schedule,
      title: 'Quadro regular de horários',
      description: text,
      type: 'CLASS' as const,
      links: [],
      metadata: { contextOnly: 'true' },
    }));
}

export async function collectAllPortalItems(page: Page): Promise<PortalItem[]> {
  const results: PortalItem[] = [];
  for (const collector of [
    collectMessages,
    collectClassPosts,
    collectEadActivities,
    collectServiceHistory,
    collectCalendarEvents,
    collectRegularSchedule,
  ]) {
    results.push(...(await collector(page)));
  }
  return results;
}
