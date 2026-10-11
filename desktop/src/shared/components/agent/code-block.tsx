import {
  CodeBlockContent as SharedCodeBlockContent,
  type CodeBlockContentProps as SharedCodeBlockContentProps,
} from "@codexly/ui/agent/code-block-content";
import { writeClipboardText } from "@codexly/frontend-core/clipboard";
import { Check, Copy } from "lucide-react";
import {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
} from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../core/button.js";
import type { CodeBlockLanguage, HighlightLanguage } from "./code-languages.js";
import type { CodeBlockPage } from "./code-block-pages.js";
import { CodeTokenCache, type TokenizedCode } from "./code-token-cache.js";

export type { CodeBlockLanguage } from "./code-languages.js";

type CodeBlockContextValue = Readonly<{
  getCode: () => string;
}>;

const CodeBlockContext = createContext<CodeBlockContextValue | null>(null);
const tokenCache = new CodeTokenCache();

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

export type CodeBlockContentProps = Omit<
  SharedCodeBlockContentProps,
  "tokenizeCode" | "legacyTheme"
>;

export function CodeBlockContent(props: CodeBlockContentProps) {
  return (
    <SharedCodeBlockContent
      {...props}
      tokenizeCode={tokenizeCode}
      legacyTheme={import.meta.env.VITE_MACOS_LEGACY === "true"}
    />
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
          {...(onHighlightedLineUnavailable === undefined ? {} : { onHighlightedLineUnavailable })}
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
  getText?: () => string;
  onCopy?: () => void;
  onError?: (error: Error) => void;
  timeout?: number;
};

export function CodeBlockCopyButton({
  children,
  className = "",
  onClick,
  onCopy,
  getText,
  onError,
  timeout = 2_000,
  ...props
}: CodeBlockCopyButtonProps) {
  const context = useContext(CodeBlockContext);
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
      await writeClipboardText(getText?.() ?? context?.getCode() ?? "");
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
