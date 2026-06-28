import path from "path";

export function isPathInside(baseDir: string, candidate: string): boolean {
  const base = path.resolve(baseDir);
  const relative = path.relative(base, path.resolve(candidate));
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}
