import type { CompanyAddress } from '#types';
import type { Page } from 'puppeteer';
import { LINKEDIN_USER_AGENT } from './waitForLinkedInPage.js';
import { parseCompanyAddress } from '#utils/parseCompanyAddress.js';

export async function extractCompanyAddress(
  page: Page,
  companyPageUrl: string,
): Promise<CompanyAddress> {
  const companyPage = await page.browser().newPage();
  try {
    await companyPage.setUserAgent({
      userAgent: LINKEDIN_USER_AGENT,
      platform: 'macOS',
    });
    const cleanUrl = new URL(companyPageUrl);
    cleanUrl.search = '';
    await companyPage.goto(cleanUrl.toString(), {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await companyPage.waitForSelector('#address-0', { timeout: 15_000 });
    const paragraphs = await companyPage.evaluate(() => {
      const addressEls: Element[] = [];
      for (let i = 0; i < 20; i++) {
        const el = document.querySelector(`#address-${i}`);
        if (!el) break;
        addressEls.push(el);
      }
      const firstEl = addressEls[0];
      if (!firstEl) return null;
      const primaryEl =
        addressEls.find((el) => /primär/i.test(el.textContent ?? '')) ??
        firstEl;
      return Array.from(primaryEl.querySelectorAll('p'))
        .map((p) => p.textContent?.trim() ?? '')
        .filter((t) => t.length > 0);
    });
    const address = paragraphs ? parseCompanyAddress(paragraphs) : null;
    if (!address)
      throw new Error(
        `Could not extract company address from company page: ${companyPageUrl}`,
      );
    return address;
  } finally {
    await companyPage.close();
  }
}
