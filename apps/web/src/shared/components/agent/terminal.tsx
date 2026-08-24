import Anser from "anser";
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

import { useTranslation } from "../../../i18n/i18n.js";
import { materializeChunkedText, type ChunkedText } from "../../lib/chunked-text.js";
import { Button } from "../core/button.js";
import { createIncrementalAnsiParser } from "./terminal-ansi.js";

type TerminalOutput = string | ChunkedText;

type TerminalContextValue = Readonly<{
  autoScroll: boolean;
  isStreaming: boolean;
  output: TerminalOutput;
}>;

const TerminalContext = createContext<TerminalContextValue | null>(null);

function toAnsiStyle(entry: Anser.AnserJsonEntry): CSSProperties {
  const decorations = new Set(entry.decorations);
  const foreground = entry.fg_truecolor || entry.fg;
  const background = entry.bg_truecolor || entry.bg;
  const reversed = decorations.has("reverse");
  const effectiveForeground = reversed ? background : foreground;
  const effectiveBackground = reversed ? foreground : background;
  const textDecorations = [
    decorations.has("underline") ? "underline" : null,
    decorations.has("strikethrough") ? "line-through" : null,
  ].filter((value): value is string => value !== null);

  return {
    ...(effectiveBackground ? { backgroundColor: `rgb(${effectiveBackground})` } : {}),
    ...(effectiveForeground ? { color: `rgb(${effectiveForeground})` } : {}),
    ...(decorations.has("bold") ? { fontWeight: 700 } : {}),
    ...(decorations.has("dim") ? { opacity: 0.5 } : {}),
    ...(decorations.has("hidden") ? { visibility: "hidden" } : {}),
    ...(decorations.has("italic") ? { fontStyle: "italic" } : {}),
    ...(textDecorations.length > 0 ? { textDecorationLine: textDecorations.join(" ") } : {}),
  };
}

function AnsiOutput({ output }: Readonly<{ output: TerminalOutput }>) {
  const incrementalParserRef = useRef(createIncrementalAnsiParser());
  const entries = useMemo(() => {
    if (typeof output === "string") {
      return Anser.ansiToJson(output, { remove_empty: true });
    }
    return incrementalParserRef.current.parse(output.chunks, output.startIndex);
  }, [output]);

  return (
    <span className="block whitespace-pre-wrap break-words">
      {entries.map((entry, index) => {
        // 只把 ANSI SGR 转成 React 样式节点，绝不调用解析器的 linkify/HTML 接口。
        const style = toAnsiStyle(entry);
        return Object.keys(style).length === 0 ? (
          entry.content
        ) : (
          <span key={`${index.toString()}:${entry.content.length.toString()}`} style={style}>
            {entry.content}
          </span>
        );
      })}
    </span>
  );
}

function useTerminalContext(): TerminalContextValue {
  const context = useContext(TerminalContext);
  if (context === null) {
    throw new Error("Terminal components must be rendered inside Terminal");
  }
  return context;
}

export type TerminalProps = HTMLAttributes<HTMLDivElement> & {
  autoScroll?: boolean;
  isStreaming?: boolean;
  output: TerminalOutput;
};

export function Terminal({
  autoScroll = true,
  children,
  className = "",
  isStreaming = false,
  output,
  ...props
}: TerminalProps) {
  const contextValue = useMemo(
    () => ({ autoScroll, isStreaming, output }),
    [autoScroll, isStreaming, output],
  );

  return (
    <TerminalContext.Provider value={contextValue}>
      <div
        className={`mb-2 overflow-hidden rounded-control bg-raised text-foreground shadow-sm ${className}`}
        data-streaming={isStreaming}
        data-terminal=""
        {...props}
      >
        {children}
      </div>
    </TerminalContext.Provider>
  );
}

export type TerminalHeaderProps = HTMLAttributes<HTMLDivElement>;

export function TerminalHeader({ className = "", ...props }: TerminalHeaderProps) {
  return (
    <div
      className={`flex min-h-8 items-center border-b border-separator px-2.5 ${className}`}
      {...props}
    />
  );
}

export type TerminalTitleProps = HTMLAttributes<HTMLDivElement>;

export function TerminalTitle({ className = "", ...props }: TerminalTitleProps) {
  return <div className={`text-meta font-medium text-muted-foreground ${className}`} {...props} />;
}

export type TerminalActionsProps = HTMLAttributes<HTMLDivElement>;

export function TerminalActions({ className = "", ...props }: TerminalActionsProps) {
  return <div className={`ml-auto flex items-center ${className}`} {...props} />;
}

export type TerminalCopyButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onError"> & {
  onCopy?: () => void;
  onError?: (error: Error) => void;
  timeout?: number;
};

export function TerminalCopyButton({
  className = "",
  onClick,
  onCopy,
  onError,
  timeout = 2_000,
  ...props
}: TerminalCopyButtonProps) {
  const { output } = useTerminalContext();
  const { t } = useTranslation("conversation");
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimerRef.current !== null) {
        clearTimeout(resetTimerRef.current);
      }
    },
    [],
  );

  const copyOutput = async () => {
    try {
      // 历史输出只允许复制，不提供清空或编辑入口。
      await navigator.clipboard.writeText(materializeChunkedText(output));
      setCopied(true);
      onCopy?.();
      if (resetTimerRef.current !== null) {
        clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = setTimeout(() => {
        setCopied(false);
      }, timeout);
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error("Unable to copy terminal output"));
    }
  };

  return (
    <Button
      variant="ghost"
      aria-label={copied ? t("agentComponents.copiedOutput") : t("agentComponents.copyOutput")}
      className={`grid size-7 place-items-center rounded-control text-muted-foreground transition-colors hover:bg-control-hover hover:text-foreground ${className}`}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          void copyOutput();
        }
      }}
      title={copied ? t("agentComponents.copied") : t("agentComponents.copyOutput")}
      type="button"
      {...props}
    >
      {copied ? (
        <Check className="size-3.5" aria-hidden="true" />
      ) : (
        <Copy className="size-3.5" aria-hidden="true" />
      )}
    </Button>
  );
}

export type TerminalContentProps = HTMLAttributes<HTMLDivElement>;

export function TerminalContent({ children, className = "", ...props }: TerminalContentProps) {
  const { autoScroll, isStreaming, output } = useTerminalContext();
  const { t } = useTranslation("conversation");
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!autoScroll) {
      return;
    }
    const content = contentRef.current;
    if (content !== null) {
      // 每次增量输出后跟随到底部，避免流式日志停留在旧位置。
      content.scrollTop = content.scrollHeight;
    }
  }, [autoScroll, output]);

  return (
    <div
      aria-busy={isStreaming}
      aria-live={isStreaming ? "polite" : "off"}
      className={`max-h-72 overflow-auto px-3 py-2 font-mono text-meta leading-5 ${className}`}
      ref={contentRef}
      {...props}
    >
      <AnsiOutput output={output} />
      {isStreaming ? (
        <span
          aria-label={t("agentComponents.streamingOutput")}
          className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-muted-foreground align-middle"
          role="status"
        />
      ) : null}
      {children}
    </div>
  );
}
