import type { CompanyAddress } from '#types';
import type { Page } from 'puppeteer';

export function parseCompanyAddress(
  paragraphs: string[],
): CompanyAddress | null {
  const [p1, p2] = paragraphs;
  if (!p1 || !p2) return null;

  const streetAddress = p1;
  const firstComma = p2.indexOf(',');
  const lastComma = p2.lastIndexOf(',');
  if (firstComma === -1 || firstComma === lastComma) return null;

  const city = p2.slice(0, firstComma).trim();
  const postalCode = p2.slice(firstComma + 1, lastComma).trim();
  const countryCode = p2.slice(lastComma + 1).trim();
  if (!city || !postalCode || !countryCode) return null;

  return { streetAddress, city, postalCode, countryCode };
}

export async function extractCompanyAddress(
  page: Page,
  companyPageUrl: string,
): Promise<CompanyAddress> {
  const [companyTarget] = await Promise.all([
    page
      .browser()
      .waitForTarget((t) => t.opener() === page.target(), { timeout: 15_000 }),
    page.click('a.topcard__org-name-link.topcard__flavor--black-link'),
  ]);
  const companyPage = await companyTarget.asPage();
  if (!companyPage)
    throw new Error(`Could not open company page: ${companyPageUrl}`);
  try {
    await companyPage.waitForSelector('#address-0', { timeout: 15_000 });
    const paragraphs = await companyPage.evaluate(() => {
      const addressDiv = document.querySelector('#address-0');
      if (!addressDiv) return null;
      return Array.from(addressDiv.querySelectorAll('p')).map(
        (p) => p.textContent?.trim() ?? '',
      );
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
