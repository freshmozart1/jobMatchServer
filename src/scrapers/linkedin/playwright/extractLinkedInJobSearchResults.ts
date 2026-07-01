import type { Page } from "playwright";
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

  // Click the list item. LinkedIn's JS intercepts the click, loads the job
  // detail into the right pane via AJAX, and updates the URL's currentJobId
  // param — no full page navigation occurs.
  const target = card.jobId
    ? page
        .locator(`[${JOB_CARD_URN_ATTR}="urn:li:jobPosting:${card.jobId}"]`)
        .first()
    : page.locator(JOB_CARDS_SELECTOR).nth(index);

  // Wire up the response watcher BEFORE clicking so the response is never missed
  // if LinkedIn's AJAX call fires faster than a post-click waitForResponse setup.
  // This mirrors the pattern in scrollLinkedInLazyLoadedJobsUntilComplete.
  const responsePromise = page
    .waitForResponse(
      (response) => response.url().includes(DETAIL_PANE_API_PATH),
      { timeout: DETAIL_PANE_UPDATE_TIMEOUT_MS },
    )
    .catch(() => undefined);

  await target.click({ timeout: 15_000 });
  await responsePromise;

  // Verify the page URL updated with the expected currentJobId. LinkedIn's JS
  // updates the URL synchronously via history.pushState when it handles the click.
  // If the URL did not update, the click was blocked (e.g. a sign-in gate appeared
  // after the guest view limit was reached) and the detail pane shows stale data.
  if (card.jobId !== null) {
    const updatedUrl = page.url();
    if (!updatedUrl.includes(`currentJobId=${card.jobId}`)) {
      throw new Error(
        `Detail pane did not update after clicking card ${card.jobId} — ` +
          "LinkedIn may be showing a sign-in gate. Remaining cards on this page will be skipped.",
      );
    }
  }

  // Wait for the detail pane's title to be visible, confirming the DOM has
  // updated with the newly selected job's content before extraction begins.
  await page
    .waitForSelector(`${DETAIL_PANE_SELECTOR} .top-card-layout__title`, {
      state: "visible",
      timeout: 5_000,
    })
    .catch(() => undefined);
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

export async function extractLinkedInJobSearchResults(
  page: Page,
): Promise<
  Array<{ detailUrl: string | null; extracted: ExtractedLinkedInJobPage }>
> {
  const cards: LinkedInJobSearchResultCard[] = await listLinkedInJobSearchResultCards(page);
  const results: Array<{
    detailUrl: string | null;
    extracted: ExtractedLinkedInJobPage;
  }> = [];

  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index];
    if (!card) continue;

    try {
      await clickLinkedInJobSearchResultCard(page, card, index);
      const extracted = await extractLinkedInJobDetailPane(page);
      results.push({ detailUrl: card.detailUrl, extracted });
    } catch (err) {
      console.warn(
        `Skipping job card at index ${index} (${card.detailUrl ?? "unknown URL"}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return results;
}
