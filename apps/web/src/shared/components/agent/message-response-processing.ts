import { MarkdownMessageResponseProcessor } from "@codexly/frontend-core/markdown-message-response";
import type { ProcessedMessageResponse as SharedResponse } from "@codexly/frontend-core/incremental-message-response";
import { createIncrementalMarkdownBlockParser as createParser } from "@codexly/frontend-core/incremental-markdown-blocks";
import { parseMarkdownIntoBlocks } from "streamdown";
import {
  parseCodeCommentDirective,
  parseCodeComments,
  type CodeComment,
  type ParsedCodeComments,
} from "./code-comments.js";
import { normalizeMarkdownEmphasisBoundaries } from "@codexly/frontend-core/markdown-emphasis";
export { normalizeMarkdownEmphasisBoundaries } from "@codexly/frontend-core/markdown-emphasis";

const WINDOWS_MARKDOWN_FILE_REFERENCE_PATTERN =
  /(?<=\]\()(?:[a-z]:[\\/]|\\\\)[^)\r\n]+?\.[a-z0-9]+(?::\d+(?::\d+)?)?(?=\))/gi;
const RELATIVE_MARKDOWN_FILE_REFERENCE_PATTERN =
  /(?<=\]\()(?![a-z][a-z0-9+.-]*:|\/|#)[^)\r\n]+?\.[a-z0-9]+(?::\d+(?::\d+)?)?(?=\))/gi;
const LOCAL_MARKDOWN_FILE_REFERENCE_PATTERN =
  /(?<=\]\()\/(?!\/)[^)\r\n]+?\.[a-z0-9]+(?::\d+(?::\d+)?)?(?=\))/gi;
export const UNC_FILE_REFERENCE_PREFIX = "/__codexly_unc__/";
export const RELATIVE_FILE_REFERENCE_PREFIX = "/__codexly_relative__/";

export function normalizeMarkdownFileReferences(markdown: string): string {
  // 路径目标不会跨行；该约束允许流式处理只保留尚未结束的当前行。
  return markdown
    .replace(WINDOWS_MARKDOWN_FILE_REFERENCE_PATTERN, (reference) => {
      const normalizedReference = reference.replaceAll("\\", "/");
      if (/^[a-z]:/i.test(normalizedReference)) {
        return `/${normalizedReference}`;
      }
      return `${UNC_FILE_REFERENCE_PREFIX}${normalizedReference.slice(2)}`;
    })
    .replace(
      RELATIVE_MARKDOWN_FILE_REFERENCE_PATTERN,
      (reference) => `${RELATIVE_FILE_REFERENCE_PREFIX}${reference}`,
    )
    .replace(LOCAL_MARKDOWN_FILE_REFERENCE_PATTERN, (reference) =>
      reference.replaceAll(" ", "%20").replaceAll("\t", "%09"),
    );
}

export function preprocessMessageResponse(markdown: string): ParsedCodeComments {
  const parsedResponse = parseCodeComments(markdown);
  return {
    comments: parsedResponse.comments,
    markdown: normalizeMarkdownEmphasisBoundaries(
      normalizeMarkdownFileReferences(parsedResponse.markdown),
    ),
  };
}

export type ProcessedMessageResponse = SharedResponse<CodeComment>;

export class IncrementalMessageResponseProcessor extends MarkdownMessageResponseProcessor<CodeComment> {
  constructor() {
    super({
      parseComment: parseCodeCommentDirective,
      normalizeReferences: normalizeMarkdownFileReferences,
    });
  }
}

export function createIncrementalMarkdownBlockParser(parse = parseMarkdownIntoBlocks) {
  return createParser(parse);
}
