import { chromium } from "playwright";
import type { CompanyAddress } from "#types";
import { parseCompanyAddress } from "#utils/parseCompanyAddress.js";
import { LINKEDIN_USER_AGENT } from "./waitForLinkedInPage.js";

export async function extractCompanyAddress(
  companyPageUrl: string,
): Promise<CompanyAddress> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1366, height: 900 },
      userAgent: LINKEDIN_USER_AGENT,
    });
    const page = await context.newPage();
    const cleanUrl = new URL(companyPageUrl);
    cleanUrl.search = "";
    await page.goto(cleanUrl.toString(), {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.waitForSelector("#address-0", { timeout: 5_000 }).catch(() => {
      throw new Error(`No address found on company page: ${companyPageUrl}`);
    });
    const paragraphs = await page.evaluate(() => {
      const addressEls: Element[] = [];
      for (let i = 0; i < 20; i++) {
        const el = document.querySelector(`#address-${i}`);
        if (!el) break;
        addressEls.push(el);
      }
      const firstEl = addressEls[0];
      if (!firstEl) return null;
      const primaryEl =
        addressEls.find((el) => /primär/i.test(el.textContent ?? "")) ??
        firstEl;
      return Array.from(primaryEl.querySelectorAll("p"))
        .map((p) => p.textContent?.trim() ?? "")
        .filter((t) => t.length > 0);
    });
    const address = paragraphs ? parseCompanyAddress(paragraphs) : null;
    if (!address)
      throw new Error(
        `Could not extract company address from company page: ${companyPageUrl}`,
      );
    return address;
  } finally {
    await browser.close();
  }
}
