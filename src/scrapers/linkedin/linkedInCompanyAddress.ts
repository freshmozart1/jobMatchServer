import type { CompanyAddress } from '#types';
import type { Page } from 'puppeteer';
import { LINKEDIN_USER_AGENT } from './waitForLinkedInPage.js';

function stripGermanStateNameFromPostalCode(postalCode: string): string {
  const stateNames = [
    'Baden-Württemberg',
    'Bayern',
    'Berlin',
    'Brandenburg',
    'Bremen',
    'Hamburg',
    'Hessen',
    'Mecklenburg-Vorpommern',
    'Niedersachsen',
    'Nordrhein-Westfalen',
    'Rheinland-Pfalz',
    'Saarland',
    'Sachsen',
    'Sachsen-Anhalt',
    'Schleswig-Holstein',
    'Thüringen',
  ];
  //Remove state name from beginning of postal code if present
  for (const stateName of stateNames) {
    if (postalCode.startsWith(stateName)) {
      return postalCode.slice(stateName.length).trim();
    }
  }
  return postalCode;
}

const LABEL_PARAGRAPH_PATTERN = /primär/i;

export function parseCompanyAddress(
  paragraphs: string[],
): CompanyAddress | null {
  for (let i = 0; i < paragraphs.length; i++) {
    const cityPostalCountry = paragraphs[i];
    if (!cityPostalCountry) continue;

    const firstComma = cityPostalCountry.indexOf(',');
    const lastComma = cityPostalCountry.lastIndexOf(',');
    if (firstComma === -1 || firstComma === lastComma) continue;

    const city = cityPostalCountry.slice(0, firstComma).trim();
    const postalCode = stripGermanStateNameFromPostalCode(
      cityPostalCountry.slice(firstComma + 1, lastComma).trim(),
    );
    const countryCode = cityPostalCountry.slice(lastComma + 1).trim();
    if (!city || !postalCode || !countryCode) continue;

    // Search backward from the city line for the nearest non-label street address
    for (let j = i - 1; j >= 0; j--) {
      const streetAddress = paragraphs[j];
      if (!streetAddress || LABEL_PARAGRAPH_PATTERN.test(streetAddress))
        continue;
      return { streetAddress, city, postalCode, countryCode };
    }
  }
  return null;
}

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
