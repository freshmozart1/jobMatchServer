import type { ScrapedAnchor } from '#types';

export function collectAnchorsFromDocument(): { anchors: ScrapedAnchor[] } {
  const anchors = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('a[href]'),
  ).map((anchor) => {
    const closestContextElement = anchor.closest(
      '[data-job-id], li, article, div',
    );
    const className = closestContextElement?.className;
    const parentClassNames =
      typeof className === 'string'
        ? className.split(/\s+/).filter(Boolean).slice(0, 8)
        : [];
    const text = anchor.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const ariaLabel =
      anchor.getAttribute('aria-label')?.replace(/\s+/g, ' ').trim() ||
      undefined;
    const nearbyText =
      closestContextElement?.textContent
        ?.replace(/\s+/g, ' ')
        .trim()
        .slice(0, 500) ?? '';

    return {
      href: anchor.href,
      text,
      ariaLabel,
      parentClassNames,
      nearbyText,
    };
  });

  return { anchors };
}
