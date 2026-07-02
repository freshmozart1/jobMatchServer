import type { Page, Response } from "playwright";
import type { ExtractedLinkedInJobPage } from "#types";

// Selectors verified against the live LinkedIn guest job-search page (public, unauthenticated).
// The guest page renders a two-pane layout at viewport widths ≥1128 px: a left list of job cards
// and a right detail section (.two-pane-serp-page__detail-view) that updates in place via AJAX
// when a card is clicked.
const JOB_CARDS_SELECTOR = "ul.jobs-search__results-list > li";
const JOB_CARD_URN_ATTR = "data-entity-urn";
const JOB_CARD_LINK_SELECTOR = "a.base-card__full-link";
const DETAIL_PANE_SELECTOR = ".two-pane-serp-page__detail-view";
const DETAIL_PANE_API_PATH = "/jobs-guest/jobs/api/jobPosting/";
const DETAIL_PANE_UPDATE_TIMEOUT_MS = 5_000;
const MAX_CONSECUTIVE_CARD_FAILURES = 3;

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
    (error.name === "TimeoutError" || error.message.includes("Timeout"))
  );
}

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
          const urn = li.querySelector<HTMLElement>("[" + urnAttr + "]");
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

export async function clickLinkedInJobSearchResultCard(
  page: Page,
  card: LinkedInJobSearchResultCard,
  index: number,
): Promise<void> {
  // Dismiss any sign-in overlay modals that would intercept the click.
  // These modals appear repeatedly as contextual nags; removing them directly
  // is more reliable than waiting for multiple .modal__dismiss buttons.
  await page.evaluate(() => {
    document.querySelectorAll(".modal__overlay").forEach((el) => el.remove());
  });

  // Click the list item by its position within ul.jobs-search__results-list.
  // LinkedIn's JS intercepts the click, loads the job detail into the right pane
  // via AJAX, and updates the URL's currentJobId param — no full page navigation
  // occurs. Always use an index-scoped locator: a page-wide [data-entity-urn]
  // query can resolve to "Similar jobs" section cards that carry the same URN
  // but are not interactable in the two-pane layout.
  const target = page.locator(JOB_CARDS_SELECTOR).nth(index);

  // Wire up the response watcher BEFORE clicking so the response is never missed
  // if LinkedIn's AJAX call fires faster than a post-click waitForResponse setup.
  // The response is diagnostics only — the DOM check below is authoritative
  // (LinkedIn server-renders the first card's detail, so clicking it may fire no
  // request at all). The catch must be attached at creation: the promise may
  // settle unobserved on the happy path, and an unhandled rejection would crash
  // the process under Node's default policy.
  const expectedResponsePath = card.jobId
    ? DETAIL_PANE_API_PATH + card.jobId
    : DETAIL_PANE_API_PATH;
  const responsePromise: Promise<Response | null> = page
    .waitForResponse(
      (response) => response.url().includes(expectedResponsePath),
      { timeout: DETAIL_PANE_UPDATE_TIMEOUT_MS },
    )
    .catch((error: unknown) => {
      if (!isTimeoutError(error)) {
        console.warn(
          `jobPosting response watcher failed for card at index ${index}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return null;
    });

  await target.click({ timeout: 15_000 });

  if (card.jobId === null) {
    // Without a job id there is nothing to verify the pane against; give the
    // pane its best chance to settle by waiting out the API response window.
    console.warn(
      `Job card at index ${index} has no data-entity-urn job id; cannot verify the detail pane updated.`,
    );
    await responsePromise;
    return;
  }

  // Authoritative check that the pane now renders the clicked job. LinkedIn
  // updates the page URL via history.pushState even when the content fetch
  // fails (e.g. rate-limited), so only the pane's own job-view link proves the
  // DOM updated. Resolves instantly for the server-rendered first card and
  // polls through the response-arrived-but-DOM-not-yet-patched race.
  try {
    await page.waitForSelector(detailPaneJobLinkSelector(card.jobId), {
      state: "visible",
      timeout: DETAIL_PANE_UPDATE_TIMEOUT_MS,
    });
  } catch (error) {
    if (!isTimeoutError(error)) throw error;
    // The watcher shares the click's timeout window, so it has settled by now.
    const response = await responsePromise;
    if (response === null) {
      throw new Error(
        `Detail pane did not render job ${card.jobId} and no jobPosting API response was observed — the click may have been intercepted or fired no request.`,
      );
    }
    if (!response.ok()) {
      throw new Error(
        `Detail pane did not render job ${card.jobId} — jobPosting API responded ${response.status()}; LinkedIn is likely rate-limiting guest job detail requests.`,
      );
    }
    throw new Error(
      `Detail pane did not render job ${card.jobId} although the jobPosting API responded ${response.status()}.`,
    );
  }
}

export async function extractLinkedInJobDetailPane(
  page: Page,
): Promise<ExtractedLinkedInJobPage> {
  return page.evaluate((detailPaneSel) => {
    const paneMaybe = document.querySelector<HTMLElement>(detailPaneSel);
    if (!paneMaybe) throw new Error("LinkedIn detail pane not found.");
    // Shadow with an explicitly non-nullable typed binding so closures can
    // reference it without TypeScript widening back to HTMLElement | null.
    const pane: HTMLElement = paneMaybe;

    function normalizeText(value: string | null | undefined): string | null {
      const v = value?.replace(/\s+/g, " ").trim() ?? "";
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
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
      if (!(node instanceof HTMLElement)) return "";
      const tag = node.tagName.toLowerCase();
      if (tag === "br") return "\n";
      const children = Array.from(node.childNodes).map(renderNode).join("");
      if (tag === "strong" || tag === "b") return `**${children}**`;
      if (tag === "em" || tag === "i") return `*${children}*`;
      if (tag === "li")
        return `\n- ${children.replace(/ /g, " ").replace(/\s+/g, " ").trim()}`;
      if (tag === "ul" || tag === "ol") return `\n${children}\n\n`;
      return children;
    }

    function getDescription(): string | null {
      const selectors = [".show-more-less-html__markup", ".description__text"];
      for (const sel of selectors) {
        const el = pane.querySelector(sel);
        if (!el) continue;
        const rendered = Array.from(el.childNodes)
          .map(renderNode)
          .join("")
          .replace(/ /g, " ")
          .replace(/\r\n?/g, "\n")
          .replace(/[\t ]+\n/g, "\n")
          .replace(/\n[\t ]+/g, "\n")
          .replace(/[\t ]{2,}/g, " ")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
        if (rendered.length > 0) return rendered;
      }
      return null;
    }

    const titleSelectors = [".top-card-layout__title", "h2", "h1"];
    const locationSelectors = [".topcard__flavor--bullet"];
    const postedAtSelectors = [".posted-time-ago__text", "time"];
    const tagSelectors = [".description__job-criteria-text"];

    const title = getFirstText(titleSelectors);
    const company = normalizeText(
      pane.querySelector<HTMLElement>("a.topcard__org-name-link")?.textContent,
    );
    const location = getFirstText(locationSelectors);
    const descriptionText = getDescription();
    const postedAt = getFirstText(postedAtSelectors);
    const tags = getAllTexts(tagSelectors).slice(0, 12);

    const companyAnchor = pane.querySelector<HTMLAnchorElement>(
      "a.topcard__org-name-link",
    );

    return {
      title,
      company,
      location,
      descriptionText,
      postedAt,
      tags,
      companyPageUrl: companyAnchor?.href ?? "",
    };
  }, DETAIL_PANE_SELECTOR);
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
  const results: LinkedInJobSearchResultsExtraction["results"] = [];
  let consecutiveFailures = 0;
  let aborted = false;

  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index];
    if (!card) continue;

    try {
      await clickLinkedInJobSearchResultCard(page, card, index);
      const extracted = await extractLinkedInJobDetailPane(page);
      results.push({ detailUrl: card.detailUrl, extracted });
      consecutiveFailures = 0;
    } catch (err) {
      console.warn(
        `Skipping job card at index ${index} (${card.detailUrl ?? "unknown URL"}): ${err instanceof Error ? err.message : String(err)}`,
      );
      consecutiveFailures += 1;
      if (consecutiveFailures >= MAX_CONSECUTIVE_CARD_FAILURES) {
        // When the detail pane stops updating (e.g. guest rate limit), every
        // remaining card fails identically — stop hammering LinkedIn.
        console.warn(
          `Aborting remaining ${cards.length - index - 1} card(s) on this page after ${consecutiveFailures} consecutive failures — LinkedIn is likely rate-limiting guest job detail requests.`,
        );
        aborted = true;
        break;
      }
    }
  }

  return { results, aborted };
}
