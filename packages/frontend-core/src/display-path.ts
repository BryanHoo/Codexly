export function formatDisplayPath(path: string): string;
export function formatDisplayPath(path: string | undefined): string | undefined;
export function formatDisplayPath(path: string | null): string | null;
export function formatDisplayPath(path: string | null | undefined): string | null | undefined;
/** Format UI paths only; filesystem requests and identities retain their original paths. */
export function formatDisplayPath(path: string | null | undefined): string | null | undefined {
  if (!path?.startsWith("\\\\?\\")) return path;
  const suffix = path.slice(4);
  if (/^UNC\\/iu.test(suffix)) return `\\\\${suffix.slice(4)}`;
  return /^[a-z]:\\/iu.test(suffix) ? suffix : path;
}
