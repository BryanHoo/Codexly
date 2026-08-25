/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- 评论行需要键盘焦点来显示与悬停一致的说明浮层。 */
import { MessageSquareText } from "lucide-react";
import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Streamdown } from "streamdown";

import { useTranslation } from "../../../i18n/i18n.js";

export type CodeComment = Readonly<{
  body: string;
  end: number | null;
  file: string;
  priority: number | null;
  start: number | null;
  title: string;
}>;

export type ParsedCodeComments = Readonly<{
  comments: CodeComment[];
  markdown: string;
}>;

const CODE_COMMENT_DIRECTIVE_PATTERN = /^::code-comment\{(.*)\}\s*$/gm;
const CODE_COMMENT_DIRECTIVE_LINE_PATTERN = /^::code-comment\{(.*)\}\s*$/;
const CODE_COMMENT_ATTRIBUTE_PATTERN = /([a-z]+)=(?:"((?:\\.|[^"\\])*)"|(\d+))/g;
const PROJECT_RELATIVE_PATH_MARKERS = ["/apps/", "/packages/", "/src/", "/tests/", "/.superwork/"];
const COMMENT_TOOLTIP_GAP = 8;
const COMMENT_TOOLTIP_VIEWPORT_PADDING = 12;

type CommentTooltipPosition = Readonly<{
  left: number;
  top: number;
}>;

function decodeQuotedAttribute(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value;
  }
}

function parseCodeCommentAttributes(source: string): CodeComment | null {
  const attributes = new Map<string, string>();

  for (const match of source.matchAll(CODE_COMMENT_ATTRIBUTE_PATTERN)) {
    const attributeName = match[1];
    const quotedValue = match[2];
    const numericValue = match[3];
    if (attributeName !== undefined) {
      attributes.set(
        attributeName,
        quotedValue === undefined ? (numericValue ?? "") : decodeQuotedAttribute(quotedValue),
      );
    }
  }

  const body = attributes.get("body");
  const file = attributes.get("file");
  const title = attributes.get("title");
  if (body === undefined || file === undefined || title === undefined) {
    return null;
  }

  const parseOptionalNumber = (name: string): number | null => {
    const value = attributes.get(name);
    return value === undefined ? null : Number.parseInt(value, 10);
  };

  return {
    body,
    end: parseOptionalNumber("end"),
    file,
    priority: parseOptionalNumber("priority"),
    start: parseOptionalNumber("start"),
    title,
  };
}

export function parseCodeCommentDirective(source: string): CodeComment | null {
  const attributes = CODE_COMMENT_DIRECTIVE_LINE_PATTERN.exec(source)?.[1];
  return attributes === undefined ? null : parseCodeCommentAttributes(attributes);
}

export function parseCodeComments(markdown: string): ParsedCodeComments {
  const comments: CodeComment[] = [];
  const markdownWithoutDirectives = markdown.replace(
    CODE_COMMENT_DIRECTIVE_PATTERN,
    (directive, attributes: string) => {
      const comment = parseCodeCommentAttributes(attributes);
      if (comment === null) {
        return directive;
      }

      comments.push(comment);
      return "";
    },
  );

  return {
    comments,
    markdown: markdownWithoutDirectives.replace(/\n{3,}/g, "\n\n").trim(),
  };
}

function getProjectRelativePath(file: string): string {
  for (const marker of PROJECT_RELATIVE_PATH_MARKERS) {
    const markerIndex = file.indexOf(marker);
    if (markerIndex >= 0) {
      return file.slice(markerIndex + 1);
    }
  }

  return file.split(/[\\/]/).at(-1) ?? file;
}

function formatCodeLocation(comment: CodeComment): string {
  const displayPath = getProjectRelativePath(comment.file);
  if (comment.start === null) {
    return displayPath;
  }

  const lineRange =
    comment.end === null || comment.end === comment.start
      ? String(comment.start)
      : `${String(comment.start)}-${String(comment.end)}`;
  return `${displayPath}:${lineRange}`;
}

function formatCodeCommentTitle(title: string): string {
  return title.replace(/^\[P\d+\]\s*/, "");
}

function CodeCommentItem({
  comment,
  commentIndex,
}: Readonly<{ comment: CodeComment; commentIndex: number }>) {
  const rowRef = useRef<HTMLLIElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const tooltipId = useId();
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState<CommentTooltipPosition>();
  const commentTitle = formatCodeCommentTitle(comment.title);
  const commentLocation = formatCodeLocation(comment);

  const updateTooltipPosition = useCallback(() => {
    const row = rowRef.current;
    const tooltip = tooltipRef.current;
    if (row === null || tooltip === null) {
      return;
    }

    const rowRect = row.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const maximumLeft = Math.max(
      COMMENT_TOOLTIP_VIEWPORT_PADDING,
      window.innerWidth - tooltipRect.width - COMMENT_TOOLTIP_VIEWPORT_PADDING,
    );
    const left = Math.min(Math.max(rowRect.left, COMMENT_TOOLTIP_VIEWPORT_PADDING), maximumLeft);
    const fitsBelow =
      rowRect.bottom + COMMENT_TOOLTIP_GAP + tooltipRect.height <=
      window.innerHeight - COMMENT_TOOLTIP_VIEWPORT_PADDING;
    const preferredTop = fitsBelow
      ? rowRect.bottom + COMMENT_TOOLTIP_GAP
      : rowRect.top - tooltipRect.height - COMMENT_TOOLTIP_GAP;
    const maximumTop = Math.max(
      COMMENT_TOOLTIP_VIEWPORT_PADDING,
      window.innerHeight - tooltipRect.height - COMMENT_TOOLTIP_VIEWPORT_PADDING,
    );

    // Tooltip 使用 Portal 脱离会话滚动容器，并限制在视口安全区域内。
    setTooltipPosition({
      left,
      top: Math.min(Math.max(preferredTop, COMMENT_TOOLTIP_VIEWPORT_PADDING), maximumTop),
    });
  }, []);

  useLayoutEffect(() => {
    if (!tooltipVisible) {
      setTooltipPosition(undefined);
      return;
    }

    updateTooltipPosition();
    window.addEventListener("resize", updateTooltipPosition);
    window.addEventListener("scroll", updateTooltipPosition, true);
    return () => {
      window.removeEventListener("resize", updateTooltipPosition);
      window.removeEventListener("scroll", updateTooltipPosition, true);
    };
  }, [tooltipVisible, updateTooltipPosition]);

  return (
    <li
      aria-describedby={tooltipVisible ? tooltipId : undefined}
      className="flex min-w-0 cursor-pointer items-center gap-3 rounded-control px-1 py-2 text-body-small transition-colors hover:bg-control-hover focus-visible:bg-control-hover"
      key={`${comment.file}:${String(comment.start)}:${String(commentIndex)}`}
      onBlur={() => {
        setTooltipVisible(false);
      }}
      onFocus={() => {
        setTooltipVisible(true);
      }}
      onMouseEnter={() => {
        setTooltipVisible(true);
      }}
      onMouseLeave={() => {
        setTooltipVisible(false);
      }}
      ref={rowRef}
      tabIndex={0}
    >
      <span className="shrink-0 rounded-control border border-separator-strong px-1.5 py-0.5 text-label text-muted-foreground">
        {comment.priority === null ? "--" : `P${String(comment.priority)}`}
      </span>
      <span className="min-w-0 shrink font-semibold text-foreground">{commentTitle}</span>
      <span className="min-w-0 truncate text-muted-foreground">{commentLocation}</span>
      {tooltipVisible && typeof document !== "undefined"
        ? createPortal(
            <div
              className="pointer-events-none fixed z-50 w-[min(28rem,calc(100vw-1.5rem))] rounded-surface border border-separator-strong bg-raised p-3 text-left shadow-floating"
              id={tooltipId}
              ref={tooltipRef}
              role="tooltip"
              style={
                tooltipPosition === undefined
                  ? { left: 0, top: 0, visibility: "hidden" }
                  : { left: tooltipPosition.left, top: tooltipPosition.top }
              }
            >
              <div className="flex items-center gap-2">
                <span className="rounded-control border border-separator-strong px-1.5 py-0.5 text-label text-muted-foreground">
                  {comment.priority === null ? "--" : `P${String(comment.priority)}`}
                </span>
                <p className="font-semibold text-foreground">{commentTitle}</p>
              </div>
              <p className="mt-2 break-all font-mono text-meta text-muted-foreground">
                {commentLocation}
              </p>
              <Streamdown
                className="mt-2 text-body-small leading-5 text-foreground [&_a]:text-brand [&_a]:underline [&_a]:underline-offset-2 [&_code]:font-mono [&_code]:text-body-small [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                controls={false}
              >
                {comment.body}
              </Streamdown>
            </div>,
            document.body,
          )
        : null}
    </li>
  );
}

export function CodeComments({ comments }: Readonly<{ comments: CodeComment[] }>) {
  const { t } = useTranslation("conversation");
  if (comments.length === 0) {
    return null;
  }

  return (
    <section
      aria-label={t("agentComponents.codeComments", { count: comments.length })}
      className="my-4 overflow-hidden rounded-surface border border-separator-strong bg-raised"
      data-code-comments="true"
    >
      <header className="flex min-h-12 items-center gap-3 border-b border-separator px-4 text-body font-semibold">
        <span className="grid size-8 place-items-center rounded-control bg-control">
          <MessageSquareText className="size-4 text-muted-foreground" aria-hidden="true" />
        </span>
        <span>{t("agentComponents.codeComments", { count: comments.length })}</span>
      </header>
      <ol className="divide-y divide-separator px-4 py-1">
        {comments.map((comment, commentIndex) => (
          <CodeCommentItem
            comment={comment}
            commentIndex={commentIndex}
            key={`${comment.file}:${String(comment.start)}:${String(commentIndex)}`}
          />
        ))}
      </ol>
    </section>
  );
}
