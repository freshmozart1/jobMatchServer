export function getScraperErrorStatus(error: unknown): number {
  if (
    error instanceof Error &&
    error.message.toLowerCase().includes('timeout')
  ) {
    return 504;
  }

  return 502;
}
