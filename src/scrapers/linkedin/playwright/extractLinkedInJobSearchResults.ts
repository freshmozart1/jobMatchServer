import type { Page } from 'playwright';
import type { ExtractedLinkedInJobPage } from '#types';
import { clearLinkedInOverlays } from './waitForLinkedInPage.js';

// Selectors verified against the live LinkedIn guest job-search page (public, unauthenticated).
// The guest page renders a two-pane layout at viewport widths ≥1128 px: a left list of job cards
// and a right detail section (.two-pane-serp-page__detail-view) that updates in place via AJAX
// when a card is clicked.
const JOB_CARDS_SELECTOR = 'ul.jobs-search__results-list > li';
const JOB_CARD_URN_ATTR = 'data-entity-urn';
const JOB_CARD_LINK_SELECTOR = 'a.base-card__full-link';
// Belt-and-suspenders: LinkedIn's guest job list can append a handful of
// trailing, non-job `<li>`s after the real cards (no title, clicking them
// does nothing useful) — scoping to items that actually contain a title
// heading keeps the counted total and the clicked index in sync so the click
// loop never targets one of those.
const JOB_CARD_TITLE_SELECTOR = 'h3';
const JOB_CARD_COMPANY_SELECTOR = 'h4.base-search-card__subtitle';
const DETAIL_PANE_SELECTOR = '.two-pane-serp-page__detail-view';
const DETAIL_PANE_UPDATE_TIMEOUT_MS = 5_000;
const MAX_CONSECUTIVE_CARD_FAILURES = 3;
const DELAY_BETWEEN_JOBS_MS = 700;

const SEE_MORE_BUTTON_SELECTOR = 'button.infinite-scroller__show-more-button';
const VIEWED_ALL_JOBS_SELECTOR = '.see-more-jobs__viewed-all';
const MAX_SCROLL_ATTEMPTS = 60;
const STABLE_SCROLLS_TO_STOP = 3;
const SCROLL_SETTLE_MS = 800;
const MAX_SEE_MORE_CLICKS = 200; // circuit breaker, not an expected real limit
const STABLE_CLICKS_TO_STOP = 3; // same rationale as STABLE_SCROLLS_TO_STOP
const SEE_MORE_POLL_ATTEMPTS = 10;
const SEE_MORE_POLL_INTERVAL_MS = 300;

// Lightweight, single-pass overlay check used around each per-card click —
// unlike the patient multi-second poll used once at page load, this only
// needs to catch (and clear) whatever is covering the page *right now*.
const PER_INTERACTION_OVERLAY_OPTIONS = { requiredConsecutiveClear: 1 };

// The pane's topcard title anchor links to the job-view URL, whose slug ends with the
// numeric job id (…/jobs/view/<slug>-<jobId>). Matching on href rather than the
// topcard__link class keeps the check resilient to markup churn; the id is \d+ from
// the URN regex, so interpolation is injection-safe.
function detailPaneJobLinkSelector(jobId: string): string {
  return `${DETAIL_PANE_SELECTOR} a[href*="/jobs/view/"][href*="${jobId}"]`;
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'TimeoutError' || error.message.includes('Timeout'))
  );
}

// LinkedIn guest cards commonly layer a secondary company-name/logo anchor
// (a normal, non-intercepted link to /company/...) on top of the full-link
// overlay in part of the card. A coordinate-based Playwright click can land on
// it and trigger a real navigation away from the results page. This substring
// check deliberately only looks for the /jobs/search path segment (not "did
// the URL change at all") because LinkedIn's own AJAX pane-swap legitimately
// rewrites the URL via history.pushState (adding currentJobId=...) while
// staying on /jobs/search — checking for any change would false-positive on
// that, which is why an earlier, stricter URL guard was removed.
const NAVIGATED_AWAY_PREFIX = 'Navigated away from LinkedIn job search results';

function isNavigatedAwayError(error: unknown): boolean {
  return (
    error instanceof Error && error.message.startsWith(NAVIGATED_AWAY_PREFIX)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type LinkedInJobSearchResultCard = {
  jobId: string | null;
  detailUrl: string | null;
};

export async function listLinkedInJobSearchResultCards(
  page: Page,
): Promise<LinkedInJobSearchResultCard[]> {
  return page.evaluate(
    ({ listSel, urnAttr, linkSel, titleSel }) => {
      return Array.from(document.querySelectorAll<HTMLElement>(listSel))
        .filter((li) => li.querySelector(titleSel))
        .map((li) => {
          const urn = li.querySelector<HTMLElement>('[' + urnAttr + ']');
          const rawUrn = urn?.getAttribute(urnAttr) ?? null;
          const jobIdMatch = rawUrn?.match(/jobPosting:(\d+)/);
          const jobId = jobIdMatch?.[1] ?? null;

          const link = li.querySelector<HTMLAnchorElement>(linkSel);
          return { jobId, detailUrl: link?.href ?? null };
        });
    },
    {
      listSel: JOB_CARDS_SELECTOR,
      urnAttr: JOB_CARD_URN_ATTR,
      linkSel: JOB_CARD_LINK_SELECTOR,
      titleSel: JOB_CARD_TITLE_SELECTOR,
    },
  );
}

async function isSelectorVisible(
  page: Page,
  selector: string,
): Promise<boolean> {
  return page.evaluate((sel) => {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== 'hidden' &&
      style.display !== 'none'
    );
  }, selector);
}

async function evaluateClick(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel) => {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) return false;
    el.click();
    return true;
  }, selector);
}

// Counts unique job IDs rather than raw `<li>` nodes: LinkedIn's guest
// pagination can silently re-serve an earlier page verbatim on a long enough
// session, which raw DOM counting can't distinguish from genuine growth.
async function countUniqueJobIds(page: Page): Promise<number> {
  const cards = await listLinkedInJobSearchResultCards(page);
  return new Set(
    cards
      .map((card) => card.jobId)
      .filter((jobId): jobId is string => jobId !== null),
  ).size;
}

async function scrollToPageBottom(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scrollElement = document.scrollingElement ?? document.documentElement;
    window.scrollTo(0, scrollElement.scrollHeight);
  });
}

// Phase A: LinkedIn's own scroll-triggered infinite scroll, which loads jobs
// in batches of 10 automatically until the list reaches 120 items — at that
// point LinkedIn hides this behavior behind a manual "See more jobs" button
// instead (Phase B below), so stop scrolling the moment that button appears
// rather than waiting for scroll growth to go stable on its own (it can
// appear before that happens). Returns the unique job count once scrolling
// stops, as the starting point for Phase B.
async function scrollLoadPhase(
  page: Page,
  options: LoadAllJobsOptions,
): Promise<number> {
  const maxScrollAttempts = options.maxScrollAttempts ?? MAX_SCROLL_ATTEMPTS;
  const stableScrollsToStop =
    options.stableScrollsToStop ?? STABLE_SCROLLS_TO_STOP;
  const scrollSettleMs = options.scrollSettleMs ?? SCROLL_SETTLE_MS;
  let previousUniqueCount = 0;
  let stableReads = 0;

  for (let attempt = 0; attempt < maxScrollAttempts; attempt += 1) {
    const currentUniqueCount = await countUniqueJobIds(page);

    if (currentUniqueCount === previousUniqueCount) {
      stableReads += 1;
      if (stableReads >= stableScrollsToStop) break;
    } else {
      stableReads = 0;
    }
    previousUniqueCount = currentUniqueCount;

    if (await isSelectorVisible(page, SEE_MORE_BUTTON_SELECTOR)) break;

    await scrollToPageBottom(page);
    if (scrollSettleMs > 0) await sleep(scrollSettleMs);
  }

  return previousUniqueCount;
}

async function pollForJobCountChange(
  page: Page,
  previousCount: number,
  pollAttempts: number,
  pollIntervalMs: number,
): Promise<number> {
  let currentCount = previousCount;
  for (let poll = 0; poll < pollAttempts; poll += 1) {
    if (pollIntervalMs > 0) await sleep(pollIntervalMs);
    currentCount = await countUniqueJobIds(page);
    if (currentCount !== previousCount) break;
  }
  return currentCount;
}

// Phase B: past 120 items LinkedIn requires clicking "See more jobs" for each
// further batch of 10 instead of auto-loading on scroll. Stops once
// LinkedIn's own "You've viewed all jobs for this search" banner appears, the
// button itself goes away, or growth stalls for several consecutive clicks
// (the same stale/repeated-page risk countUniqueJobIds() already guards
// against in Phase A). The next batch of 10 arrives asynchronously after a
// "See more" click, so this polls briefly rather than assuming it's already
// in the DOM.
async function clickLoadPhase(
  page: Page,
  initialUniqueCount: number,
  options: LoadAllJobsOptions,
): Promise<void> {
  const maxSeeMoreClicks = options.maxSeeMoreClicks ?? MAX_SEE_MORE_CLICKS;
  const stableClicksToStop =
    options.stableClicksToStop ?? STABLE_CLICKS_TO_STOP;
  const pollAttempts = options.seeMorePollAttempts ?? SEE_MORE_POLL_ATTEMPTS;
  const pollIntervalMs =
    options.seeMorePollIntervalMs ?? SEE_MORE_POLL_INTERVAL_MS;
  let previousUniqueCount = initialUniqueCount;
  let stableClicks = 0;

  for (let attempt = 0; attempt < maxSeeMoreClicks; attempt += 1) {
    if (await isSelectorVisible(page, VIEWED_ALL_JOBS_SELECTOR)) break;
    if (!(await isSelectorVisible(page, SEE_MORE_BUTTON_SELECTOR))) break;

    // The sign-in nag can reappear here too — clear it before every click.
    await clearLinkedInOverlays(page, PER_INTERACTION_OVERLAY_OPTIONS);
    const clicked = await evaluateClick(page, SEE_MORE_BUTTON_SELECTOR);
    if (!clicked) break;

    const currentUniqueCount = await pollForJobCountChange(
      page,
      previousUniqueCount,
      pollAttempts,
      pollIntervalMs,
    );

    if (currentUniqueCount === previousUniqueCount) {
      stableClicks += 1;
      if (stableClicks >= stableClicksToStop) break;
    } else {
      stableClicks = 0;
    }
    previousUniqueCount = currentUniqueCount;
  }
}

export type LoadAllJobsOptions = {
  maxScrollAttempts?: number;
  stableScrollsToStop?: number;
  scrollSettleMs?: number;
  maxSeeMoreClicks?: number;
  stableClicksToStop?: number;
  seeMorePollAttempts?: number;
  seeMorePollIntervalMs?: number;
};

export async function loadAllLinkedInJobSearchResults(
  page: Page,
  options: LoadAllJobsOptions = {},
): Promise<void> {
  const afterScrollCount = await scrollLoadPhase(page, options);
  await clickLoadPhase(page, afterScrollCount, options);
}

// Clicks the Nth *valid* job card (same title-filtered ordering
// listLinkedInJobSearchResultCards uses) via a direct JS click on its own
// detail-link anchor rather than a Playwright coordinate click on the parent
// `<li>`: a coordinate click is satisfied by any descendant receiving the
// hit-tested pixel, including a secondary company-name/logo link LinkedIn
// layers on top of the full-link overlay in part of the card, which would
// trigger a normal, non-intercepted navigation away from the results page.
export async function clickLinkedInJobSearchResultCard(
  page: Page,
  index: number,
): Promise<boolean> {
  return page.evaluate(
    ({ listSel, linkSel, titleSel, cardIndex }) => {
      const items = Array.from(
        document.querySelectorAll<HTMLElement>(listSel),
      ).filter((li) => li.querySelector(titleSel));
      const li = items[cardIndex];
      if (!li) return false;
      const link = li.querySelector<HTMLAnchorElement>(linkSel);
      if (!link) return false;
      link.click();
      return true;
    },
    {
      listSel: JOB_CARDS_SELECTOR,
      linkSel: JOB_CARD_LINK_SELECTOR,
      titleSel: JOB_CARD_TITLE_SELECTOR,
      cardIndex: index,
    },
  );
}

// The company name shown in the list card doesn't change on click, unlike the
// detail pane's — reading it lets scrapeLinkedInJobSearchResultCard() compare
// the two and catch a pane that silently kept showing a previous job's data.
async function readListCardCompany(
  page: Page,
  index: number,
): Promise<string | null> {
  return page.evaluate(
    ({ listSel, titleSel, companySel, cardIndex }) => {
      const items = Array.from(
        document.querySelectorAll<HTMLElement>(listSel),
      ).filter((li) => li.querySelector(titleSel));
      const li = items[cardIndex];
      if (!li) return null;
      const text = li.querySelector(companySel)?.textContent ?? '';
      const normalized = text.replace(/\s+/g, ' ').trim();
      return normalized.length > 0 ? normalized : null;
    },
    {
      listSel: JOB_CARDS_SELECTOR,
      titleSel: JOB_CARD_TITLE_SELECTOR,
      companySel: JOB_CARD_COMPANY_SELECTOR,
      cardIndex: index,
    },
  );
}

export async function extractLinkedInJobDetailPane(
  page: Page,
): Promise<ExtractedLinkedInJobPage> {
  return page.evaluate((detailPaneSel) => {
    const paneMaybe = document.querySelector<HTMLElement>(detailPaneSel);
    if (!paneMaybe) throw new Error('LinkedIn detail pane not found.');
    // Shadow with an explicitly non-nullable typed binding so closures can
    // reference it without TypeScript widening back to HTMLElement | null.
    const pane: HTMLElement = paneMaybe;

    function normalizeText(value: string | null | undefined): string | null {
      const v = value?.replace(/\s+/g, ' ').trim() ?? '';
      return v.length > 0 ? v : null;
    }

    function getFirstText(selectors: string[]): string | null {
      for (const sel of selectors) {
        const text = normalizeText(pane.querySelector(sel)?.textContent);
        if (text) return text;
      }
      return null;
    }

    function getAllTexts(selectors: string[]): string[] {
      const values = new Set<string>();
      for (const sel of selectors) {
        for (const el of Array.from(pane.querySelectorAll(sel))) {
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

    function getDescription(): string | null {
      const selectors = ['.show-more-less-html__markup', '.description__text'];
      for (const sel of selectors) {
        const el = pane.querySelector(sel);
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

    const titleSelectors = ['.top-card-layout__title', 'h2', 'h1'];
    const locationSelectors = ['.topcard__flavor--bullet'];
    const postedAtSelectors = ['.posted-time-ago__text', 'time'];
    const tagSelectors = ['.description__job-criteria-text'];

    const title = getFirstText(titleSelectors);
    const company = normalizeText(
      pane.querySelector<HTMLElement>('a.topcard__org-name-link')?.textContent,
    );
    const location = getFirstText(locationSelectors);
    const descriptionText = getDescription();
    const postedAt = getFirstText(postedAtSelectors);
    const tags = getAllTexts(tagSelectors).slice(0, 12);

    const companyAnchor = pane.querySelector<HTMLAnchorElement>(
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
  }, DETAIL_PANE_SELECTOR);
}

type ScrapeCardResult = {
  extracted: ExtractedLinkedInJobPage;
  stale: boolean;
};

// Clicks the card at `index`, confirms (best-effort) that the detail pane now
// shows *that* job, and extracts its full field set. Returns `stale: true`
// rather than throwing when the confirmation is merely inconclusive (pane
// didn't visibly settle in time, company text disagrees with the list card,
// or an overlay was still up when we read the data) — those jobs get exactly
// one retry after the full list has been scraped once, instead of being
// discarded outright on what may just be a slow render.
async function scrapeLinkedInJobSearchResultCard(
  page: Page,
  card: LinkedInJobSearchResultCard,
  index: number,
  detailPaneUpdateTimeoutMs: number,
): Promise<ScrapeCardResult> {
  const listCompany = await readListCardCompany(page, index);

  await clearLinkedInOverlays(page, PER_INTERACTION_OVERLAY_OPTIONS);

  const clicked = await clickLinkedInJobSearchResultCard(page, index);
  if (!clicked) {
    throw new Error(
      `Job card at index ${index} — could not find ${JOB_CARD_LINK_SELECTOR} to click (card missing or markup drift).`,
    );
  }

  // Fast, distinct detection of a genuine full navigation. Checked before any
  // further waiting since we already know deterministically the page is gone.
  if (!page.url().includes('/jobs/search')) {
    throw new Error(
      `${NAVIGATED_AWAY_PREFIX} while clicking card at index ${index} (now at ${page.url()}).`,
    );
  }

  let paneConfirmed: boolean;
  if (card.jobId === null) {
    // Without a job id there is nothing to verify the pane against; give the
    // pane a moment to settle and proceed — flagged as stale below only via
    // the company-mismatch/late-overlay signals, same as any other card.
    console.warn(
      `Job card at index ${index} has no data-entity-urn job id; cannot verify the detail pane updated.`,
    );
    await sleep(300);
    paneConfirmed = true;
  } else {
    paneConfirmed = await page
      .waitForSelector(detailPaneJobLinkSelector(card.jobId), {
        state: 'visible',
        timeout: detailPaneUpdateTimeoutMs,
      })
      .then(() => true)
      .catch((error: unknown) => {
        if (isTimeoutError(error)) return false;
        throw error;
      });
  }

  const extracted = await extractLinkedInJobDetailPane(page);
  const lateOverlayDetected = await clearLinkedInOverlays(
    page,
    PER_INTERACTION_OVERLAY_OPTIONS,
  );
  const companyMismatch =
    listCompany !== null &&
    extracted.company !== null &&
    listCompany !== extracted.company;

  return {
    extracted,
    stale: !paneConfirmed || companyMismatch || lateOverlayDetected,
  };
}

export type LinkedInJobSearchResultsExtraction = {
  results: Array<{
    detailUrl: string | null;
    extracted: ExtractedLinkedInJobPage;
  }>;
  aborted: boolean;
};

export type ExtractLinkedInJobSearchResultsOptions = LoadAllJobsOptions & {
  delayBetweenJobsMs?: number;
  detailPaneUpdateTimeoutMs?: number;
};

export async function extractLinkedInJobSearchResults(
  page: Page,
  options: ExtractLinkedInJobSearchResultsOptions = {},
): Promise<LinkedInJobSearchResultsExtraction> {
  const delayBetweenJobsMs =
    options.delayBetweenJobsMs ?? DELAY_BETWEEN_JOBS_MS;
  const detailPaneUpdateTimeoutMs =
    options.detailPaneUpdateTimeoutMs ?? DETAIL_PANE_UPDATE_TIMEOUT_MS;

  await loadAllLinkedInJobSearchResults(page, options);

  const cards = await listLinkedInJobSearchResultCards(page);
  const results: LinkedInJobSearchResultsExtraction['results'] = [];
  const staleEntries: Array<{ cardIndex: number; resultIndex: number }> = [];
  // A job ID already scraped successfully earlier in this same request is
  // skipped rather than re-clicked/re-embedded — LinkedIn's guest pagination
  // can silently re-serve an earlier page's cards.
  const seenJobIds = new Set<string>();
  let consecutiveFailures = 0;

  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index];
    if (!card) continue;
    if (card.jobId !== null && seenJobIds.has(card.jobId)) continue;

    try {
      const { extracted, stale } = await scrapeLinkedInJobSearchResultCard(
        page,
        card,
        index,
        detailPaneUpdateTimeoutMs,
      );
      results.push({ detailUrl: card.detailUrl, extracted });
      if (card.jobId !== null) seenJobIds.add(card.jobId);
      if (stale) {
        staleEntries.push({
          cardIndex: index,
          resultIndex: results.length - 1,
        });
      }
      consecutiveFailures = 0;
    } catch (err) {
      console.warn(
        `Skipping job card at index ${index} (${card.detailUrl ?? 'unknown URL'}): ${err instanceof Error ? err.message : String(err)}`,
      );

      if (isNavigatedAwayError(err)) {
        // The results-list DOM is gone; no point retrying or waiting for a
        // 3-strike streak.
        console.warn(
          `Aborting remaining ${cards.length - index - 1} card(s) — navigated away from the search results unexpectedly.`,
        );
        return { results, aborted: true };
      }

      consecutiveFailures += 1;
      if (consecutiveFailures >= MAX_CONSECUTIVE_CARD_FAILURES) {
        console.warn(
          `Aborting remaining ${cards.length - index - 1} card(s) after ${consecutiveFailures} consecutive failures.`,
        );
        return { results, aborted: true };
      }
    }

    await sleep(delayBetweenJobsMs);
  }

  // Deferred until the whole list has been scraped once — by then the page
  // has settled down, giving stale cards a better chance the second time
  // instead of compounding retries into the middle of the first pass.
  for (const { cardIndex, resultIndex } of staleEntries) {
    const card = cards[cardIndex];
    if (!card) continue;

    await sleep(delayBetweenJobsMs);

    try {
      const { extracted } = await scrapeLinkedInJobSearchResultCard(
        page,
        card,
        cardIndex,
        detailPaneUpdateTimeoutMs,
      );
      const existing = results[resultIndex];
      if (existing) {
        results[resultIndex] = { detailUrl: existing.detailUrl, extracted };
      }
    } catch (err) {
      console.warn(
        `Retry failed for stale job card at index ${cardIndex}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { results, aborted: false };
}
