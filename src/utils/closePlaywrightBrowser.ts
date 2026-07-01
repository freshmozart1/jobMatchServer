import type { BrowserServer } from 'playwright';

const DEFAULT_CLOSE_TIMEOUT_MS = 5_000;

export async function closePlaywrightBrowserServer(
  browserServer: BrowserServer,
  timeoutMs: number = DEFAULT_CLOSE_TIMEOUT_MS,
): Promise<void> {
  try {
    await raceCloseAgainstTimeout(browserServer, timeoutMs);
  } catch {
    await browserServer.kill().catch(() => undefined);
  }
}

async function raceCloseAgainstTimeout(
  browserServer: BrowserServer,
  timeoutMs: number,
): Promise<void> {
  let timeoutHandle: NodeJS.Timeout | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error('browserServer.close() timed out')),
      timeoutMs,
    );
  });

  try {
    await Promise.race([browserServer.close(), timeout]);
  } finally {
    clearTimeout(timeoutHandle);
  }
}
