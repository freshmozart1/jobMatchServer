import type { ExtractedLinkedInJobPage } from '#types';
import type { Page } from 'puppeteer';

export async function extractLinkedInJobPage(
  page: Page,
): Promise<ExtractedLinkedInJobPage> {
  await page.click('#base-contextual-sign-in-modal > div > section > button');
  await page.click('button.show-more-less-button');
  return page.evaluate(() => {
    type JsonRecord = Record<string, unknown>;

    const titleSelectors = [
      'h1.top-card-layout__title',
      '.top-card-layout__title',
      '.job-details-jobs-unified-top-card__job-title h1',
      'h1',
    ];
    const companySelectors = [
      'a.topcard__org-name-link',
      '.topcard__org-name-link',
      '.topcard__flavor-row .topcard__flavor:first-child',
      '.base-card__subtitle',
    ];
    const locationSelectors = [
      '.topcard__flavor--bullet',
      '.job-search-card__location',
      '.jobs-unified-top-card__bullet',
    ];
    const descriptionSelectors = [
      '.show-more-less-html__markup',
      '.description__text',
      'section.description',
      '.jobs-description__content',
      '.jobs-box__html-content',
    ];
    const postedAtSelectors = [
      'time',
      '.posted-time-ago__text',
      '.topcard__flavor--metadata',
    ];
    const tagSelectors = [
      '.description__job-criteria-text',
      '.job-criteria__text',
      '.jobs-unified-top-card__job-insight',
    ];

    function normalizeText(value: string | null | undefined): string | null {
      const normalizedValue = value?.replace(/\s+/g, ' ').trim() ?? '';
      return normalizedValue.length > 0 ? normalizedValue : null;
    }

    function normalizeRenderedDescription(value: string): string | null {
      const normalizedValue = value
        .replace(/ /g, ' ')
        .replace(/\r\n?/g, '\n')
        .replace(/[\t ]+\n/g, '\n')
        .replace(/\n[\t ]+/g, '\n')
        .replace(/[\t ]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      return normalizedValue.length > 0 ? normalizedValue : null;
    }

    function getFirstText(selectors: string[]): string | null {
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        const text = normalizeText(element?.textContent);
        if (text) {
          return text;
        }
      }
      return null;
    }

    function getAllTexts(selectors: string[]): string[] {
      const values = new Set<string>();
      for (const selector of selectors) {
        for (const element of Array.from(document.querySelectorAll(selector))) {
          const text = normalizeText(element.textContent);
          if (text) {
            values.add(text);
          }
        }
      }
      return Array.from(values);
    }

    function getMetaContent(names: string[]): string | null {
      const metaElements = Array.from(
        document.querySelectorAll<HTMLMetaElement>('meta'),
      );
      for (const metaElement of metaElements) {
        const metaName =
          metaElement.getAttribute('name') ??
          metaElement.getAttribute('property') ??
          '';
        if (names.includes(metaName)) {
          const content = normalizeText(metaElement.content);
          if (content) {
            return content;
          }
        }
      }
      return null;
    }

    function isRecord(value: unknown): value is JsonRecord {
      return typeof value === 'object' && value !== null;
    }

    function getString(value: unknown): string | null {
      return typeof value === 'string' ? normalizeText(value) : null;
    }

    function stripHtml(value: string | null): string | null {
      if (!value) {
        return null;
      }
      const template = document.createElement('template');
      template.innerHTML = value;
      return normalizeRenderedDescription(
        renderDescriptionNodes(Array.from(template.content.childNodes)),
      );
    }

    function wrapFormattedDescriptionText(
      marker: string,
      value: string,
    ): string {
      const normalizedValue = value.replace(/ /g, ' ').replace(/[\t ]+/g, ' ');
      const leadingSpace = /^[\t ]/.test(normalizedValue) ? ' ' : '';
      const trailingNewlines = normalizedValue.match(/\n+$/)?.[0] ?? '';
      const trailingSpace = trailingNewlines
        ? ''
        : /[\t ]$/.test(normalizedValue)
          ? ' '
          : '';
      const content = normalizedValue.trim();
      return content
        ? `${leadingSpace}${marker}${content}${marker}${trailingNewlines}${trailingSpace}`
        : '';
    }

    const FORMAT_WRAPPERS: Record<string, string> = {
      strong: '**',
      b: '**',
      em: '*',
      i: '*',
    };
    const LIST_CONTAINERS = new Set(['ul', 'ol']);

    function renderDescriptionNode(node: Node): string {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent ?? '';
      }
      if (!(node instanceof HTMLElement)) {
        return '';
      }
      const tagName = node.tagName.toLowerCase();
      if (tagName === 'br') {
        return '\n';
      }
      const renderedChildren = renderDescriptionNodes(
        Array.from(node.childNodes),
      );
      const marker = FORMAT_WRAPPERS[tagName];
      if (marker) {
        return wrapFormattedDescriptionText(marker, renderedChildren);
      }
      if (tagName === 'li') {
        return `\n- ${normalizeRenderedDescription(renderedChildren) ?? ''}`;
      }
      if (LIST_CONTAINERS.has(tagName)) {
        return `\n${renderedChildren}\n\n`;
      }
      return renderedChildren;
    }

    function renderDescriptionNodes(nodes: Node[]): string {
      return nodes.map(renderDescriptionNode).join('');
    }

    function getFirstDescription(selectors: string[]): string | null {
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        const description = element
          ? normalizeRenderedDescription(renderDescriptionNode(element))
          : null;
        if (description) {
          return description;
        }
      }
      return null;
    }

    function getJobPostingJsonLd(): JsonRecord | null {
      const candidates: JsonRecord[] = [];

      function collect(value: unknown): void {
        if (Array.isArray(value)) {
          for (const item of value) {
            collect(item);
          }
          return;
        }
        if (!isRecord(value)) {
          return;
        }
        collect(value['@graph']);
        const typeValue = value['@type'];
        const typeValues = Array.isArray(typeValue) ? typeValue : [typeValue];
        const isJobPosting = typeValues.some(
          (typeItem) =>
            typeof typeItem === 'string' &&
            typeItem.toLowerCase() === 'jobposting',
        );
        if (isJobPosting) {
          candidates.push(value);
        }
      }

      for (const scriptElement of Array.from(
        document.querySelectorAll<HTMLScriptElement>(
          'script[type="application/ld+json"]',
        ),
      )) {
        try {
          collect(JSON.parse(scriptElement.textContent ?? ''));
        } catch {
          continue;
        }
      }

      return candidates[0] ?? null;
    }

    function getHiringOrganizationName(
      jobPosting: JsonRecord | null,
    ): string | null {
      const hiringOrganization = jobPosting?.['hiringOrganization'];
      const organizations = Array.isArray(hiringOrganization)
        ? hiringOrganization
        : [hiringOrganization];
      for (const organization of organizations) {
        if (isRecord(organization)) {
          const name = getString(organization['name']);
          if (name) {
            return name;
          }
        }
      }
      return null;
    }

    function getLocation(jobPosting: JsonRecord | null): string | null {
      const jobLocation = jobPosting?.['jobLocation'];
      const locations = Array.isArray(jobLocation)
        ? jobLocation
        : [jobLocation];
      for (const location of locations) {
        if (!isRecord(location)) {
          continue;
        }
        const address = isRecord(location['address'])
          ? location['address']
          : location;
        const parts = [
          getString(address['addressLocality']),
          getString(address['addressRegion']),
          getString(address['addressCountry']),
        ].filter((part): part is string => Boolean(part));
        if (parts.length > 0) {
          return Array.from(new Set(parts)).join(', ');
        }
      }
      return null;
    }

    function getTags(jobPosting: JsonRecord | null): string[] {
      const values = new Set<string>(getAllTexts(tagSelectors));
      for (const key of [
        'employmentType',
        'industry',
        'occupationalCategory',
      ] as const) {
        const value = jobPosting?.[key];
        const items = Array.isArray(value) ? value : [value];
        for (const item of items) {
          const text = getString(item);
          if (text) {
            values.add(text);
          }
        }
      }
      return Array.from(values).slice(0, 12);
    }

    const jobPosting = getJobPostingJsonLd();
    const title =
      getString(jobPosting?.['title']) ??
      getMetaContent(['og:title', 'twitter:title']) ??
      getFirstText(titleSelectors);
    const company =
      getHiringOrganizationName(jobPosting) ?? getFirstText(companySelectors);
    const location = getLocation(jobPosting) ?? getFirstText(locationSelectors);
    const descriptionText =
      getFirstDescription(descriptionSelectors) ??
      stripHtml(getString(jobPosting?.['description'])) ??
      getMetaContent(['description', 'og:description']);
    const postedAt =
      getString(jobPosting?.['datePosted']) ?? getFirstText(postedAtSelectors);

    const companyAnchor = document.querySelector<HTMLAnchorElement>(
      'a.topcard__org-name-link.topcard__flavor--black-link',
    );
    if (!companyAnchor)
      throw new Error('Company page link not found on job page.');

    return {
      title,
      company,
      location,
      descriptionText,
      postedAt,
      tags: getTags(jobPosting),
      companyPageUrl: companyAnchor.href,
    };
  });
}
