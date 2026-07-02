import { jest } from '@jest/globals';
import type { Response } from 'express';

export default function mockResponseWithHeaders(response: Response): {
  setHeader: ReturnType<typeof jest.fn<(name: string, value: string) => void>>;
  end: ReturnType<typeof jest.fn<(data: Buffer) => void>>;
} {
  const setHeader = jest.fn<(name: string, value: string) => void>();
  const end = jest.fn<(data: Buffer) => void>();
  (
    response as unknown as { setHeader: typeof setHeader; end: typeof end }
  ).setHeader = setHeader;
  (
    response as unknown as { setHeader: typeof setHeader; end: typeof end }
  ).end = end;
  return { setHeader, end };
}
