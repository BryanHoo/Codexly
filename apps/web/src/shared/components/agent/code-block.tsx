import { Check, Copy } from "lucide-react";
import {
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
import type { CodeBlockLanguage } from "./code-languages.js";
import { CodeTokenCache, type TokenizedCode } from "./code-token-cache.js";

export type { CodeBlockLanguage } from "./code-languages.js";

type CodeBlockContextValue = Readonly<{
  code: string;
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

function createRawTokens(code: string): TokenizedCode {
  return {
    background: "transparent",
    foreground: "inherit",
    lines: code.split("\n").map((line) => (line === "" ? [] : [{ content: line, offset: 0 }])),
  };
}

function getTokenStyle(token: ThemedToken): CSSProperties {
  const sourceStyle = token.htmlStyle as
    (CSSProperties & { "--shiki-dark"?: string; "--shiki-dark-bg"?: string }) | undefined;
  const lightColor = token.color ?? sourceStyle?.color;
  const darkColor = sourceStyle?.["--shiki-dark"];
  const lightBackground = token.bgColor ?? sourceStyle?.backgroundColor;
  const darkBackground = sourceStyle?.["--shiki-dark-bg"];

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

async function tokenizeCode(code: string, language: CodeBlockLanguage): Promise<TokenizedCode> {
  if (language === "text") {
    return createRawTokens(code);
  }

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

export type CodeBlockContentProps = Readonly<{
  code: string;
  highlightedLine?: number | null;
  language: CodeBlockLanguage;
  showLineNumbers?: boolean;
}> &
  HTMLAttributes<HTMLDivElement>;

export function CodeBlockContent({
  className = "",
  code,
  highlightedLine = null,
  language,
  showLineNumbers = false,
  ...props
}: CodeBlockContentProps) {
  const rawTokens = useMemo(() => createRawTokens(code), [code]);
  const [tokenized, setTokenized] = useState(rawTokens);

  useEffect(() => {
    let active = true;
    setTokenized(rawTokens);
    void tokenizeCode(code, language)
      .then((result) => {
        if (active) {
          setTokenized(result);
        }
      })
      .catch(() => {
        // 高亮失败时继续展示完整纯文本，避免查看器因可选增强不可用而清空。
      });
    return () => {
      active = false;
    };
  }, [code, language, rawTokens]);

  return (
    <div className={`relative min-h-0 overflow-auto ${className}`} {...props}>
      <pre
        className="m-0 min-w-max bg-transparent py-3 font-mono text-body-small leading-6 text-foreground"
        style={{ backgroundColor: tokenized.background, color: tokenized.foreground }}
      >
        <code>
          {tokenized.lines.map((tokens, lineIndex) => {
            const lineNumber = lineIndex + 1;
            const highlighted = lineNumber === highlightedLine;
            return (
              <span
                className={`block min-h-6 px-3 ${
                  showLineNumbers ? "grid grid-cols-[4rem_minmax(0,1fr)]" : ""
                } ${highlighted ? "bg-brand-soft text-brand-strong" : ""}`}
                data-code-line={lineNumber}
                data-highlighted={highlighted ? "true" : undefined}
                key={lineNumber}
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
    code: string;
    highlightedLine?: number | null;
    language: CodeBlockLanguage;
    showLineNumbers?: boolean;
  }>;

export function CodeBlock({
  children,
  className = "",
  code,
  highlightedLine = null,
  language,
  showLineNumbers = false,
  style,
  ...props
}: CodeBlockProps) {
  const contextValue = useMemo(() => ({ code }), [code]);
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
          code={code}
          highlightedLine={highlightedLine}
          language={language}
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
  const { code } = useCodeBlockContext();
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
      await navigator.clipboard.writeText(code);
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
