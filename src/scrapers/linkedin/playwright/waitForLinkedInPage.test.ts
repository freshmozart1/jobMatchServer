import { describe, expect, it, jest } from '@jest/globals';
import type { Page } from 'playwright';
import { clearLinkedInOverlays } from './waitForLinkedInPage.js';

type PageMock = {
  evaluate: ReturnType<typeof jest.fn<() => Promise<boolean>>>;
};

function createPageMock(overlayReads: boolean[]): PageMock {
  const evaluate = jest.fn<() => Promise<boolean>>();
  for (const read of overlayReads) {
    evaluate.mockResolvedValueOnce(read);
  }
  evaluate.mockResolvedValue(false);
  return { evaluate };
}

describe('clearLinkedInOverlays', () => {
  it('resolves quickly with false when no overlay is ever found', async () => {
    const page = createPageMock([]);

    const dismissed = await clearLinkedInOverlays(page as unknown as Page, {
      pollIntervalMs: 0,
      requiredConsecutiveClear: 1,
    });

    expect(dismissed).toBe(false);
    expect(page.evaluate).toHaveBeenCalledTimes(1);
  });

  it('returns true after dismissing an overlay and confirming it stays cleared', async () => {
    const page = createPageMock([true]);

    const dismissed = await clearLinkedInOverlays(page as unknown as Page, {
      pollIntervalMs: 0,
      requiredConsecutiveClear: 2,
    });

    expect(dismissed).toBe(true);
    // 1 read that finds+dismisses the overlay, then 2 consecutive clear reads.
    expect(page.evaluate).toHaveBeenCalledTimes(3);
  });

  it('keeps polling through a re-appearing overlay before concluding it is clear', async () => {
    const page = createPageMock([true, false, true, false]);

    const dismissed = await clearLinkedInOverlays(page as unknown as Page, {
      pollIntervalMs: 0,
      requiredConsecutiveClear: 2,
    });

    expect(dismissed).toBe(true);
    // Sequence: found, clear(1), found again (resets streak), clear(1), clear(2) -> stop.
    expect(page.evaluate).toHaveBeenCalledTimes(5);
  });

  it('stops once the timeout budget is exhausted even if the overlay keeps reappearing', async () => {
    const page = createPageMock([true, true, true, true, true]);

    const dismissed = await clearLinkedInOverlays(page as unknown as Page, {
      pollIntervalMs: 5,
      timeoutMs: 12,
      requiredConsecutiveClear: 10,
    });

    expect(dismissed).toBe(true);
    expect(page.evaluate.mock.calls.length).toBeGreaterThan(0);
    expect(page.evaluate.mock.calls.length).toBeLessThan(10);
  });
});
