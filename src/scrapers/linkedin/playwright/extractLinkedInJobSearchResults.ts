import type { Page } from 'playwright';
import type { ExtractedLinkedInJobPage } from '#types';
import { dismissLinkedInSignInModalIfPresent } from './waitForLinkedInPage.js';

// Selectors verified against the live LinkedIn guest job-search page (public, unauthenticated)
// and the standalone guest job-view page (public, unauthenticated) each card's own detailUrl
// points to. Job detail extraction navigates directly to that URL rather than clicking the
// card in place: LinkedIn's two-pane AJAX endpoint (jobs-guest/jobs/api/jobPosting/<id>) is
// genuinely rate-limited after ~3 requests in a guest session — its client JS optimistically
// updates the URL/list-highlight via history.pushState regardless of whether the content fetch
// succeeded, so a click-and-wait approach silently freezes on stale content well before any
// error surfaces. A full navigation to the job's own /jobs/view/<slug>-<id> page is not subject
// to that same limit and reliably renders the real content instead.
const JOB_CARDS_SELECTOR = 'ul.jobs-search__results-list > li';
const JOB_CARD_URN_ATTR = 'data-entity-urn';
const JOB_CARD_LINK_SELECTOR = 'a.base-card__full-link';
// Wraps title/company/location/posted-at on the standalone job page. Fallback selectors below
// (e.g. bare 'h1'/'time') must stay scoped to this container — unscoped, they also match
// unrelated content elsewhere on the page (the cookie-consent banner is an <h2>; each of the
// dozens of "Similar jobs"/"Also viewed" sidebar cards has its own <time>).
const TOP_CARD_LAYOUT_SELECTOR = '.top-card-layout';
const JOB_DETAIL_NAVIGATION_TIMEOUT_MS = 30_000;
const JOB_DETAIL_RENDER_TIMEOUT_MS = 5_000;
const MAX_CONSECUTIVE_CARD_FAILURES = 3;

export type LinkedInJobSearchResultCard = {
  jobId: string | null;
  detailUrl: string | null;
};

export async function listLinkedInJobSearchResultCards(
  page: Page,
): Promise<LinkedInJobSearchResultCard[]> {
  return page.evaluate(
    ({ listSel, urnAttr, linkSel }) => {
      return Array.from(document.querySelectorAll<HTMLElement>(listSel)).map(
        (li) => {
          const urn = li.querySelector<HTMLElement>('[' + urnAttr + ']');
          const rawUrn = urn?.getAttribute(urnAttr) ?? null;
          const jobIdMatch = rawUrn?.match(/jobPosting:(\d+)/);
          const jobId = jobIdMatch?.[1] ?? null;

          const link = li.querySelector<HTMLAnchorElement>(linkSel);
          return { jobId, detailUrl: link?.href ?? null };
        },
      );
    },
    {
      listSel: JOB_CARDS_SELECTOR,
      urnAttr: JOB_CARD_URN_ATTR,
      linkSel: JOB_CARD_LINK_SELECTOR,
    },
  );
}

export async function extractLinkedInJobDetailPage(
  page: Page,
): Promise<ExtractedLinkedInJobPage> {
  return page.evaluate((topCardSel) => {
    const topCardMaybe = document.querySelector<HTMLElement>(topCardSel);
    if (!topCardMaybe)
      throw new Error('LinkedIn job detail top card not found.');
    // Shadow with an explicitly non-nullable typed binding so closures can
    // reference it without TypeScript widening back to HTMLElement | null.
    const topCard: HTMLElement = topCardMaybe;

    function normalizeText(value: string | null | undefined): string | null {
      const v = value?.replace(/\s+/g, ' ').trim() ?? '';
      return v.length > 0 ? v : null;
    }

    function getFirstText(
      selectors: string[],
      root: ParentNode,
    ): string | null {
      for (const sel of selectors) {
        const text = normalizeText(root.querySelector(sel)?.textContent);
        if (text) return text;
      }
      return null;
    }

    function getAllTexts(selectors: string[], root: ParentNode): string[] {
      const values = new Set<string>();
      for (const sel of selectors) {
        for (const el of Array.from(root.querySelectorAll(sel))) {
          const text = normalizeText(el.textContent);
          if (text) values.add(text);
        }
      }
      return Array.from(values);
    }

    // Description: render rich HTML (lists, bold) into plain markdown-style text.
    function renderNode(node: Node): string {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
      if (!(node instanceof HTMLElement)) return '';
      const tag = node.tagName.toLowerCase();
      if (tag === 'br') return '\n';
      const children = Array.from(node.childNodes).map(renderNode).join('');
      if (tag === 'strong' || tag === 'b') return `**${children}**`;
      if (tag === 'em' || tag === 'i') return `*${children}*`;
      if (tag === 'li')
        return `\n- ${children.replace(/ /g, ' ').replace(/\s+/g, ' ').trim()}`;
      if (tag === 'ul' || tag === 'ol') return `\n${children}\n\n`;
      return children;
    }

    // The description and criteria tags live outside .top-card-layout in their own
    // page sections, so these query the whole document — safe because both selectors
    // are specific BEM classes, not generic tags, and don't collide with sidebar cards.
    function getDescription(): string | null {
      const selectors = ['.show-more-less-html__markup', '.description__text'];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const rendered = Array.from(el.childNodes)
          .map(renderNode)
          .join('')
          .replace(/ /g, ' ')
          .replace(/\r\n?/g, '\n')
          .replace(/[\t ]+\n/g, '\n')
          .replace(/\n[\t ]+/g, '\n')
          .replace(/[\t ]{2,}/g, ' ')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        if (rendered.length > 0) return rendered;
      }
      return null;
    }

    const titleSelectors = ['.top-card-layout__title', 'h1'];
    const locationSelectors = ['.topcard__flavor--bullet'];
    const postedAtSelectors = ['.posted-time-ago__text', 'time'];
    const tagSelectors = ['.description__job-criteria-text'];

    const title = getFirstText(titleSelectors, topCard);
    const company = normalizeText(
      topCard.querySelector<HTMLElement>('a.topcard__org-name-link')
        ?.textContent,
    );
    const location = getFirstText(locationSelectors, topCard);
    const descriptionText = getDescription();
    const postedAt = getFirstText(postedAtSelectors, topCard);
    const tags = getAllTexts(tagSelectors, document).slice(0, 12);

    const companyAnchor = topCard.querySelector<HTMLAnchorElement>(
      'a.topcard__org-name-link',
    );

    return {
      title,
      company,
      location,
      descriptionText,
      postedAt,
      tags,
      companyPageUrl: companyAnchor?.href ?? '',
    };
  }, TOP_CARD_LAYOUT_SELECTOR);
}

export async function scrapeLinkedInJobDetailPage(
  page: Page,
  card: LinkedInJobSearchResultCard,
): Promise<ExtractedLinkedInJobPage> {
  if (!card.detailUrl) {
    throw new Error('Job card has no detail URL to navigate to.');
  }

  await page.goto(card.detailUrl, {
    waitUntil: 'domcontentloaded',
    timeout: JOB_DETAIL_NAVIGATION_TIMEOUT_MS,
  });

  await dismissLinkedInSignInModalIfPresent(page);

  await page.waitForSelector(TOP_CARD_LAYOUT_SELECTOR, {
    timeout: JOB_DETAIL_RENDER_TIMEOUT_MS,
  });

  return extractLinkedInJobDetailPage(page);
}

export type LinkedInJobSearchResultsExtraction = {
  results: Array<{
    detailUrl: string | null;
    extracted: ExtractedLinkedInJobPage;
  }>;
  aborted: boolean;
};

export async function extractLinkedInJobSearchResults(
  page: Page,
): Promise<LinkedInJobSearchResultsExtraction> {
  const cards: LinkedInJobSearchResultCard[] =
    await listLinkedInJobSearchResultCards(page);
  const results: LinkedInJobSearchResultsExtraction['results'] = [];
  let consecutiveFailures = 0;
  let aborted = false;

  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index];
    if (!card) continue;

    try {
      const extracted = await scrapeLinkedInJobDetailPage(page, card);
      results.push({ detailUrl: card.detailUrl, extracted });
      consecutiveFailures = 0;
    } catch (err) {
      console.warn(
        `Skipping job card at index ${index} (${card.detailUrl ?? 'unknown URL'}): ${err instanceof Error ? err.message : String(err)}`,
      );

      consecutiveFailures += 1;
      if (consecutiveFailures >= MAX_CONSECUTIVE_CARD_FAILURES) {
        console.warn(
          `Aborting remaining ${cards.length - index - 1} card(s) on this page after ${consecutiveFailures} consecutive failures.`,
        );
        aborted = true;
        break;
      }
    }
  }

  return { results, aborted };
}
