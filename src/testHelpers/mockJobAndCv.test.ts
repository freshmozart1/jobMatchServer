import { jest } from '@jest/globals';
import type { StoredCv, StoredScrapedJob } from '#types';
import { createJob } from './createJob.test.js';

export function mockJobAndCv(mocks: {
  connect: { mockResolvedValue: (value: undefined) => unknown };
  close: { mockResolvedValue: (value: undefined) => unknown };
  findOneJob: {
    mockResolvedValue: (
      value: StoredScrapedJob & { _id: { toHexString: () => string } },
    ) => unknown;
  };
  findOneCv: { mockResolvedValue: (value: StoredCv) => unknown };
  getCollection: {
    mockImplementation: (
      impl: (client: unknown, collectionName: unknown) => unknown,
    ) => unknown;
  };
  mockJobId: string;
  storedCv: StoredCv;
}): void {
  jest.clearAllMocks();
  mocks.connect.mockResolvedValue(undefined);
  mocks.close.mockResolvedValue(undefined);
  mocks.findOneJob.mockResolvedValue({
    ...createJob<StoredScrapedJob>(true),
    _id: { toHexString: () => mocks.mockJobId },
  });
  mocks.findOneCv.mockResolvedValue(mocks.storedCv);
  mocks.getCollection.mockImplementation(
    (_client: unknown, collectionName: unknown) => {
      if (collectionName === 'jobs') return { findOne: mocks.findOneJob };
      return { findOne: mocks.findOneCv };
    },
  );
}
