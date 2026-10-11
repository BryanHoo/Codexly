import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
} from "react";
import type { ThemedToken } from "shiki/core";

import type { CodeBlockLanguage, HighlightLanguage } from "./code-languages.js";
import {
  createCodePageLayout,
  createCodePageTokenStore,
  getCodePageLineTokens,
  type CodeBlockPage,
  type CodePageTokenState,
} from "./code-block-pages.js";
import type { TokenizedCode } from "./code-tokens.js";

function getTokenStyle(token: ThemedToken, legacyTheme: boolean): CSSProperties {
  const sourceStyle = token.htmlStyle as
    (CSSProperties & { "--shiki-dark"?: string; "--shiki-dark-bg"?: string }) | undefined;
  const lightColor = token.color ?? sourceStyle?.color;
  const darkColor = sourceStyle?.["--shiki-dark"];
  const lightBackground = token.bgColor ?? sourceStyle?.backgroundColor;
  const darkBackground = sourceStyle?.["--shiki-dark-bg"];

  if (legacyTheme) {
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

const CODE_LINE_HEIGHT_PX = 24;
const CODE_LINE_OVERSCAN = 16;
const CODE_VIEWPORT_INITIAL_RECT = { height: 600, width: 800 };

function useCodePageTokens(
  pages: readonly CodeBlockPage[],
  language: CodeBlockLanguage,
  tokenizeCode: (code: string, language: HighlightLanguage) => Promise<TokenizedCode>,
): readonly CodePageTokenState[] {
  const storeRef = useRef<ReturnType<typeof createCodePageTokenStore> | null>(null);
  const mountedRef = useRef(true);
  const [, setRevision] = useState(0);
  storeRef.current ??= createCodePageTokenStore();
  const store = storeRef.current;
  const states = store.reconcile(pages, language);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
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
  }, [states, store, tokenizeCode]);

  return states;
}

export type CodeBlockContentProps = Readonly<{
  highlightedLine?: number | null;
  language: CodeBlockLanguage;
  onHighlightedLineUnavailable?: () => void;
  pages: readonly CodeBlockPage[];
  tokenizeCode: (code: string, language: HighlightLanguage) => Promise<TokenizedCode>;
  legacyTheme?: boolean;
  showLineNumbers?: boolean;
}> &
  HTMLAttributes<HTMLDivElement>;

export function CodeBlockContent({
  className = "",
  highlightedLine = null,
  language,
  onHighlightedLineUnavailable,
  pages,
  tokenizeCode,
  legacyTheme = false,
  showLineNumbers = false,
  ...props
}: CodeBlockContentProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageStates = useCodePageTokens(pages, language, tokenizeCode);
  const layout = createCodePageLayout(pageStates.map((state) => state.tokenized));
  const getScrollElement = useCallback(() => scrollRef.current, []);
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLSpanElement>({
    // 固定行高只挂载视口与少量预读行，节点数不随源码总行数增长。
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
                            style={getTokenStyle(token, legacyTheme)}
                            className={legacyTheme ? "legacy-code-token" : undefined}
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
