import type { Page, Response } from 'playwright';
import { PORTAL_URLS } from './constants.js';
import type { ClassCardInput, ClassPostPageInput, MessageLinkInput, PortalItem } from './models.js';
import {
  inferItemType,
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
  const courses = await page.locator('.card-turma').evaluateAll((cards) =>
    cards.flatMap((card) => {
      const link = card.querySelector<HTMLAnchorElement>(
        'a[data-content][data-url*="saladeaula.ead.uvv.br"]',
      );
      const identifier = link?.getAttribute('data-content');
      if (!identifier) return [];
      return [{ discipline: card.textContent ?? 'Disciplina EAD', identifier }];
    }),
  );
  if (courses.length === 0) return [];

  const resolved: string[] = [];
  const failures: number[] = [];
  for (const course of courses) {
    const result = await page.evaluate(async (identifier) => {
      const response = await fetch(`/Aluno/Link/?id=${identifier}`);
      const contentType = response.headers.get('content-type') ?? '';
      if (!response.ok || !contentType.includes('application/json')) {
        return { status: response.status };
      }
      const payload = (await response.json()) as { UrlAula?: string };
      return { status: response.status, url: payload.UrlAula };
    }, course.identifier);
    if (result.url) resolved.push(result.url);
    else failures.push(result.status);
  }
  if (resolved.length === 0) {
    const status = failures[0] ?? 0;
    throw new Error(
      `SSO do Ambiente Virtual falhou para ${String(courses.length)} curso(s)${status ? ` (HTTP ${String(status)})` : ''}.`,
    );
  }

  await navigate(page, resolved[0]!);
  await navigate(page, PORTAL_URLS.eadCourses);
  if (
    new URL(page.url()).hostname !== 'saladeaula.ead.uvv.br' ||
    (await page.locator('input[name="username"],input[name="password"]').count()) > 0
  ) {
    throw new Error('SSO abriu, mas o Ambiente Virtual não confirmou uma sessão autenticada.');
  }

  const courseLinks = await page.locator('a[href*="/course/view.php?id="]').evaluateAll((links) =>
    links.map((link) => ({
      title: (link.textContent ?? '').replace(/\s+/g, ' ').trim(),
      url: (link as HTMLAnchorElement).href,
    })),
  );
  const uniqueCourses = new Map(
    courseLinks.filter((course) => course.title).map((course) => [course.url, course]),
  );
  const items: PortalItem[] = [];
  for (const course of uniqueCourses.values()) {
    await navigate(page, course.url);
    const activities: Array<{ title: string; url: string; description: string }> = await page
      .locator('a[href*="/mod/"][href*="view.php?id="]')
      .evaluateAll((links) =>
        links.map((link) => ({
          title: (link.textContent ?? '').replace(/\s+/g, ' ').trim(),
          url: (link as HTMLAnchorElement).href,
          description:
            link.closest('[data-for="cmitem"],.activity-item,.activity')?.textContent ??
            link.textContent ??
            '',
        })),
      );
    for (const activity of activities) {
      if (!activity.title) continue;
      const url = new URL(activity.url);
      const activityId = url.searchParams.get('id');
      if (!activityId) continue;
      const title = activity.title.replace(/\s+/g, ' ').trim();
      items.push({
        externalId: `ead:${url.pathname}:${activityId}`,
        origin: 'EAD',
        sourceUrl: activity.url,
        discipline: course.title,
        title,
        description: activity.description.replace(/\s+/g, ' ').trim(),
        type: inferItemType(`${title} ${activity.description}`),
        links: [activity.url],
        metadata: { moodleCourseUrl: course.url },
      });
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
