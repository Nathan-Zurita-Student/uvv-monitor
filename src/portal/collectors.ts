import type { Page, Response } from 'playwright';
import { parseMoodleActivity, type MoodleActivityInput } from '../moodle/activity-parser.js';
import { PORTAL_URLS } from './constants.js';
import type { ClassCardInput, ClassPostPageInput, MessageLinkInput, PortalItem } from './models.js';
import {
  parseCalendarResponse,
  parseClassCards,
  parseClassPostPage,
  parseMessageLinks,
  parseWorkflowResponse,
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
  return parseMessageLinks(inputs);
}

export async function collectClassPosts(page: Page): Promise<PortalItem[]> {
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
  const targets = new Map(
    summaries.map((item) => [
      item.sourceUrl,
      { url: item.sourceUrl, discipline: item.discipline ?? '' },
    ]),
  );

  for (const card of cards) {
    for (const blogUrl of card.blogUrls) {
      await navigate(page, blogUrl);
      const postUrls = await page
        .locator('a[href*="/Aluno/Post/"]')
        .evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).href));
      for (const url of postUrls) targets.set(url, { url, discipline: card.heading });
    }
  }

  const referenceYear = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
    }).format(new Date()),
  );
  const items: PortalItem[] = [];
  for (const target of targets.values()) {
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
      referenceYear,
    };
    items.push(parseClassPostPage(input));
  }
  return items;
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
