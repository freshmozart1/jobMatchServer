// fallow-ignore-file security-sink
// This function IS the path-traversal mitigation (rejects `..` escapes and
// absolute paths) — fallow flags path.resolve() with non-literal input as a
// candidate sink, but that's exactly what's being validated here. Verified
// 2026-07: callers (getApplication.ts, getCV.ts) gate every downstream
// path.resolve()/sendFile() on this check.
import path from 'path';

export function isPathInside(baseDir: string, candidate: string): boolean {
  const base = path.resolve(baseDir);
  const relative = path.relative(base, path.resolve(candidate));
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}
