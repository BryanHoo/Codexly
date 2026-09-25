import { Check, Copy } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
} from "react";
import type { ThemedToken } from "shiki/core";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../core/button.js";
import type { CodeBlockLanguage, HighlightLanguage } from "./code-languages.js";
import {
  createCodePageLayout,
  createCodePageTokenStore,
  getCodePageLineTokens,
  type CodeBlockPage,
  type CodePageTokenState,
} from "./code-block-pages.js";
import { CodeTokenCache, type TokenizedCode } from "./code-token-cache.js";

export type { CodeBlockLanguage } from "./code-languages.js";

type CodeBlockContextValue = Readonly<{
  getCode: () => string;
}>;

const CodeBlockContext = createContext<CodeBlockContextValue | null>(null);
const tokenCache = new CodeTokenCache();

function useCodeBlockContext(): CodeBlockContextValue {
  const context = useContext(CodeBlockContext);
  if (context === null) {
    throw new Error("CodeBlock components must be rendered inside CodeBlock");
  }
  return context;
}

function getTokenStyle(token: ThemedToken): CSSProperties {
  const sourceStyle = token.htmlStyle as
    (CSSProperties & { "--shiki-dark"?: string; "--shiki-dark-bg"?: string }) | undefined;
  const lightColor = token.color ?? sourceStyle?.color;
  const darkColor = sourceStyle?.["--shiki-dark"];
  const lightBackground = token.bgColor ?? sourceStyle?.backgroundColor;
  const darkBackground = sourceStyle?.["--shiki-dark-bg"];

  if (import.meta.env.VITE_MACOS_LEGACY === "true") {
    // 旧 WebKit 的亮暗色由兼容样式选择；现代构建会移除此分支。
    return { ...sourceStyle, color: lightColor, backgroundColor: lightBackground };
  }
  // 项目通过 color-scheme 切换主题，light-dark() 可直接消费 Shiki 的双主题 token。
  return {
    ...sourceStyle,
    backgroundColor:
      lightBackground === undefined || darkBackground === undefined
        ? lightBackground
        : `light-dark(${lightBackground}, ${darkBackground})`,
    color:
      lightColor === undefined || darkColor === undefined
        ? lightColor
        : `light-dark(${lightColor}, ${darkColor})`,
  };
}

async function tokenizeCode(code: string, language: HighlightLanguage): Promise<TokenizedCode> {
  const cached = tokenCache.get(language, code);
  if (cached !== undefined) {
    return cached;
  }

  // Shiki Core、Engine、主题和语法只在代码块真正需要高亮时进入浏览器。
  const { highlightCode } = await import("./code-highlighter.js");
  const tokenized = await highlightCode(code, language);
  tokenCache.set(language, code, tokenized);
  return tokenized;
}

const CODE_LINE_HEIGHT_PX = 24;
const CODE_LINE_OVERSCAN = 16;
const CODE_VIEWPORT_INITIAL_RECT = { height: 600, width: 800 };

function useCodePageTokens(
  pages: readonly CodeBlockPage[],
  language: CodeBlockLanguage,
): readonly CodePageTokenState[] {
  const storeRef = useRef<ReturnType<typeof createCodePageTokenStore> | null>(null);
  const mountedRef = useRef(true);
  const [, setRevision] = useState(0);
  storeRef.current ??= createCodePageTokenStore();
  const store = storeRef.current;
  const states = store.reconcile(pages, language);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );
  useEffect(() => {
    for (const state of states) {
      if (state.status !== "idle" || state.language === "text") continue;
      const language = state.language;
      state.status = "loading";
      void tokenizeCode(state.code, language)
        .then((tokenized) => {
          if (!mountedRef.current || !store.isCurrent(state)) return;
          state.status = "complete";
          state.tokenized = tokenized;
          setRevision((revision) => revision + 1);
        })
        .catch(() => {
          // 高亮失败时保留该页纯文本，并停止重复加载同一个失败任务。
          state.status = "complete";
        });
    }
  }, [states, store]);

  return states;
}

export type CodeBlockContentProps = Readonly<{
  highlightedLine?: number | null;
  language: CodeBlockLanguage;
  onHighlightedLineUnavailable?: () => void;
  pages: readonly CodeBlockPage[];
  showLineNumbers?: boolean;
}> &
  HTMLAttributes<HTMLDivElement>;

export function CodeBlockContent({
  className = "",
  highlightedLine = null,
  language,
  onHighlightedLineUnavailable,
  pages,
  showLineNumbers = false,
  ...props
}: CodeBlockContentProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageStates = useCodePageTokens(pages, language);
  const layout = createCodePageLayout(pageStates.map((state) => state.tokenized));
  const getScrollElement = useCallback(() => scrollRef.current, []);
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLSpanElement>({
    count: layout.lineCount,
    estimateSize: () => CODE_LINE_HEIGHT_PX,
    getScrollElement,
    initialRect: CODE_VIEWPORT_INITIAL_RECT,
    overscan: CODE_LINE_OVERSCAN,
  });
  const palette = pageStates[0]?.tokenized;

  useEffect(() => {
    if (highlightedLine === null || highlightedLine < 1) return;
    if (highlightedLine > layout.lineCount) {
      onHighlightedLineUnavailable?.();
      return;
    }
    virtualizer.scrollToIndex(highlightedLine - 1, { align: "center", behavior: "auto" });
  }, [highlightedLine, layout.lineCount, onHighlightedLineUnavailable, virtualizer]);

  return (
    <div className={`relative min-h-0 overflow-auto ${className}`} ref={scrollRef} {...props}>
      <pre
        className="relative m-0 min-w-full bg-transparent font-mono text-body-small leading-6 text-foreground"
        style={{
          backgroundColor: palette?.background ?? "transparent",
          color: palette?.foreground ?? "inherit",
          height: virtualizer.getTotalSize() + CODE_LINE_HEIGHT_PX,
        }}
      >
        <code>
          {virtualizer.getVirtualItems().map((virtualLine) => {
            const lineIndex = virtualLine.index;
            const tokens = getCodePageLineTokens(layout, lineIndex);
            const lineNumber = lineIndex + 1;
            const highlighted = lineNumber === highlightedLine;
            return (
              <span
                className={`absolute left-0 top-0 min-h-6 w-max min-w-full px-3 ${
                  showLineNumbers ? "grid grid-cols-[4rem_minmax(0,1fr)]" : ""
                } ${highlighted ? "bg-brand-soft text-brand-strong" : ""}`}
                data-code-line={lineNumber}
                data-highlighted={highlighted ? "true" : undefined}
                key={virtualLine.key}
                style={{
                  height: virtualLine.size,
                  transform: `translateY(${String(virtualLine.start + CODE_LINE_HEIGHT_PX / 2)}px)`,
                }}
              >
                {showLineNumbers ? (
                  <span
                    aria-hidden="true"
                    className={`select-none pr-4 text-right ${
                      highlighted ? "text-brand" : "text-muted-foreground"
                    }`}
                  >
                    {lineNumber}
                  </span>
                ) : null}
                <span className="whitespace-pre">
                  {tokens.length === 0
                    ? " "
                    : tokens.map((token, tokenIndex) => {
                        return (
                          <span
                            key={`${String(lineNumber)}-${String(tokenIndex)}`}
                            style={getTokenStyle(token)}
                            className={import.meta.env.VITE_MACOS_LEGACY === "true" ? "legacy-code-token" : undefined}
                          >
                            {token.content}
                          </span>
                        );
                      })}
                </span>
              </span>
            );
          })}
        </code>
      </pre>
    </div>
  );
}

export type CodeBlockProps = HTMLAttributes<HTMLDivElement> &
  Readonly<{
    code?: string;
    highlightedLine?: number | null;
    language: CodeBlockLanguage;
    onHighlightedLineUnavailable?: () => void;
    pages?: readonly CodeBlockPage[];
    showLineNumbers?: boolean;
  }>;

export function CodeBlock({
  children,
  className = "",
  code,
  highlightedLine = null,
  language,
  onHighlightedLineUnavailable,
  pages,
  showLineNumbers = false,
  style,
  ...props
}: CodeBlockProps) {
  const resolvedPages = useMemo<readonly CodeBlockPage[]>(
    () => pages ?? [{ code: code ?? "", key: "code" }],
    [code, pages],
  );
  const getCode = useCallback(
    () => resolvedPages.map((page) => page.code).join(""),
    [resolvedPages],
  );
  const contextValue = useMemo(() => ({ getCode }), [getCode]);
  return (
    <CodeBlockContext.Provider value={contextValue}>
      <div
        className={`relative w-full overflow-hidden rounded-surface bg-raised text-foreground shadow-sm ${className}`}
        data-language={language}
        style={{ containIntrinsicSize: "auto 200px", contentVisibility: "auto", ...style }}
        {...props}
      >
        {children}
        <CodeBlockContent
          highlightedLine={highlightedLine}
          language={language}
          {...(onHighlightedLineUnavailable === undefined
            ? {}
            : { onHighlightedLineUnavailable })}
          pages={resolvedPages}
          showLineNumbers={showLineNumbers}
        />
      </div>
    </CodeBlockContext.Provider>
  );
}

export type CodeBlockHeaderProps = HTMLAttributes<HTMLDivElement>;

export function CodeBlockHeader({ className = "", ...props }: CodeBlockHeaderProps) {
  return (
    <div
      className={`flex min-h-8 items-center justify-between border-b border-separator bg-control px-3 text-label text-muted-foreground ${className}`}
      {...props}
    />
  );
}

export type CodeBlockTitleProps = HTMLAttributes<HTMLDivElement>;

export function CodeBlockTitle({ className = "", ...props }: CodeBlockTitleProps) {
  return <div className={`flex min-w-0 items-center gap-2 ${className}`} {...props} />;
}

export type CodeBlockFilenameProps = HTMLAttributes<HTMLSpanElement>;

export function CodeBlockFilename({ className = "", ...props }: CodeBlockFilenameProps) {
  return <span className={`truncate font-mono ${className}`} {...props} />;
}

export type CodeBlockActionsProps = HTMLAttributes<HTMLDivElement>;

export function CodeBlockActions({ className = "", ...props }: CodeBlockActionsProps) {
  return <div className={`ml-auto flex items-center gap-1 ${className}`} {...props} />;
}

export type CodeBlockCopyButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onError"> & {
  onCopy?: () => void;
  onError?: (error: Error) => void;
  timeout?: number;
};

export function CodeBlockCopyButton({
  children,
  className = "",
  onClick,
  onCopy,
  onError,
  timeout = 2_000,
  ...props
}: CodeBlockCopyButtonProps) {
  const { getCode } = useCodeBlockContext();
  const [copied, setCopied] = useState(false);
  const { t } = useTranslation("conversation");
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimerRef.current !== null) {
        clearTimeout(resetTimerRef.current);
      }
    },
    [],
  );

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(getCode());
      setCopied(true);
      onCopy?.();
      if (resetTimerRef.current !== null) {
        clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = setTimeout(() => {
        setCopied(false);
      }, timeout);
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error("Unable to copy code"));
    }
  };

  return (
    <Button
      variant="ghost"
      aria-label={copied ? t("agentComponents.copiedCode") : t("agentComponents.copyCode")}
      className={`grid size-7 shrink-0 place-items-center rounded-control text-muted-foreground transition-colors hover:bg-control-hover hover:text-foreground ${className}`}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          void copyCode();
        }
      }}
      type="button"
      {...props}
    >
      {children ??
        (copied ? (
          <Check className="size-3.5" aria-hidden="true" />
        ) : (
          <Copy className="size-3.5" aria-hidden="true" />
        ))}
    </Button>
  );
}
