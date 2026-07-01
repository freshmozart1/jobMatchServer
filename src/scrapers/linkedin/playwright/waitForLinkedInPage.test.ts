import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { Page } from 'playwright';
import {
  isLinkedInSeeMoreJobPostingsResponse,
  scrollLinkedInLazyLoadedJobsUntilComplete,
} from './waitForLinkedInPage.js';

type ResponseMock = {
  url(): string;
  status(): number;
  request(): {
    method(): string;
  };
};

type PageMock = {
  evaluate: ReturnType<
    typeof jest.fn<() => Promise<{ distanceToBottom: number }>>
  >;
  waitForResponse: ReturnType<
    typeof jest.fn<
      (
        predicate: (response: ResponseMock) => boolean,
        options: { timeout: number },
      ) => Promise<ResponseMock>
    >
  >;
};

const linkedInLazyLoadUrl =
  'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?trk=guest_homepage-basic_guest_nav_menu_jobs&position=1&pageNum=0&start=25';

function createResponseMock({
  method = 'GET',
  status = 200,
  url = linkedInLazyLoadUrl,
}: {
  method?: string;
  status?: number;
  url?: string;
} = {}): ResponseMock {
  return {
    url: () => url,
    status: () => status,
    request: () => ({
      method: () => method,
    }),
  };
}

function createTimeoutError(): Error {
  const error = new Error('Timeout 5000ms exceeded while waiting for response');

  error.name = 'TimeoutError';

  return error;
}

function createPageMock(responses: Array<ResponseMock | Error>): PageMock {
  const evaluate = jest.fn<() => Promise<{ distanceToBottom: number }>>();
  const waitForResponse =
    jest.fn<
      (
        predicate: (response: ResponseMock) => boolean,
        options: { timeout: number },
      ) => Promise<ResponseMock>
    >();

  evaluate.mockResolvedValue({ distanceToBottom: 0 });
  waitForResponse.mockImplementation(async (predicate) => {
    const response = responses.shift() ?? createTimeoutError();

    if (response instanceof Error) {
      throw response;
    }

    if (!predicate(response)) {
      throw new Error(
        `Unexpected unmatched response in test: ${response.url()}`,
      );
    }

    return response;
  });

  return { evaluate, waitForResponse };
}

describe('waitForLinkedInPage (playwright) lazy-load scrolling', () => {
  beforeEach(() => {
    jest.spyOn(console, 'debug').mockImplementation(() => undefined);
  });

  it('matches LinkedIn see-more job posting GET responses', () => {
    expect(isLinkedInSeeMoreJobPostingsResponse(createResponseMock())).toBe(
      true,
    );
  });

  it('rejects non-GET responses and unrelated paths', () => {
    expect(
      isLinkedInSeeMoreJobPostingsResponse(
        createResponseMock({ method: 'POST' }),
      ),
    ).toBe(false);
    expect(
      isLinkedInSeeMoreJobPostingsResponse(
        createResponseMock({ url: 'https://www.linkedin.com/jobs/search' }),
      ),
    ).toBe(false);
  });

  it('scrolls again after each successful lazy-load response and stops on timeout', async () => {
    const page = createPageMock([
      createResponseMock({
        url: linkedInLazyLoadUrl.replace('start=25', 'start=25'),
      }),
      createResponseMock({
        url: linkedInLazyLoadUrl.replace('start=25', 'start=50'),
      }),
      createTimeoutError(),
    ]);

    await scrollLinkedInLazyLoadedJobsUntilComplete(page as unknown as Page, {
      responseTimeoutMs: 1,
      scrollSettleMs: 0,
    });

    expect(page.evaluate).toHaveBeenCalledTimes(3);
    expect(page.waitForResponse).toHaveBeenCalledTimes(3);
  });

  it('returns when the first bottom scroll does not trigger a lazy-load response', async () => {
    const page = createPageMock([createTimeoutError()]);

    await scrollLinkedInLazyLoadedJobsUntilComplete(page as unknown as Page, {
      responseTimeoutMs: 1,
      scrollSettleMs: 0,
    });

    expect(page.evaluate).toHaveBeenCalledTimes(1);
    expect(page.waitForResponse).toHaveBeenCalledTimes(1);
  });

  it('throws when a matching LinkedIn lazy-load response fails', async () => {
    const page = createPageMock([createResponseMock({ status: 429 })]);

    await expect(
      scrollLinkedInLazyLoadedJobsUntilComplete(page as unknown as Page, {
        responseTimeoutMs: 1,
        scrollSettleMs: 0,
      }),
    ).rejects.toThrow('LinkedIn lazy-load request failed with status 429');
  });

  it('throws when max scroll attempts are reached while lazy-load responses continue', async () => {
    const page = createPageMock([createResponseMock(), createResponseMock()]);

    await expect(
      scrollLinkedInLazyLoadedJobsUntilComplete(page as unknown as Page, {
        maxScrollAttempts: 2,
        responseTimeoutMs: 1,
        scrollSettleMs: 0,
      }),
    ).rejects.toThrow('Max LinkedIn lazy-load scroll attempts reached: 2');

    expect(page.evaluate).toHaveBeenCalledTimes(2);
  });
});
