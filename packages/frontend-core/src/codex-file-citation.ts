import { findAssistantDirectives, isLocalDirectivePath } from "./assistant-directives.js";
export const FILE_CITATION_PREFIX = "/__codexly_file_citation__/";

export type FileCitation = Readonly<{ start: number; end: number; path: string }>;
export function findFileCitations(source: string): FileCitation[] {
  return findAssistantDirectives(source).flatMap((directive) => {
    const path = directive.attributes.get("path");
    return directive.name === "codex-file-citation" && isLocalDirectivePath(path)
      ? [{ start: directive.start, end: directive.end, path }]
      : [];
  });
}

export function getFileCitationPath(href: string | undefined): string | null {
  if (!href?.startsWith(FILE_CITATION_PREFIX)) return null;
  try {
    return decodeURIComponent(href.slice(FILE_CITATION_PREFIX.length));
  } catch {
    return null;
  }
}
