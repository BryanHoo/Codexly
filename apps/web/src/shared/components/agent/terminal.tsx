import Anser from "anser";
import { Check, Copy, Terminal as TerminalIcon } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
} from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { materializeChunkedText, type ChunkedText } from "../../lib/chunked-text.js";
import { Button, type ButtonProps } from "../core/button.js";
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
    <span className="whitespace-pre-wrap break-words">
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
        className={`mb-2 flex flex-col overflow-hidden rounded-surface border border-terminal-separator bg-terminal text-terminal-foreground shadow-sm ${className}`}
        data-slot="terminal"
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
      className={`flex min-h-9 items-center justify-between border-b border-terminal-separator bg-terminal-header px-3 ${className}`}
      data-slot="terminal-header"
      {...props}
    />
  );
}

export type TerminalTitleProps = HTMLAttributes<HTMLDivElement>;

export function TerminalTitle({ children, className = "", ...props }: TerminalTitleProps) {
  return (
    <div
      className={`flex items-center gap-2 text-meta font-medium text-terminal-muted ${className}`}
      data-slot="terminal-title"
      {...props}
    >
      <TerminalIcon className="size-3.5" aria-hidden="true" />
      {children}
    </div>
  );
}

export type TerminalActionsProps = HTMLAttributes<HTMLDivElement>;

export function TerminalActions({ className = "", ...props }: TerminalActionsProps) {
  return (
    <div
      className={`ml-auto flex items-center gap-1 ${className}`}
      data-slot="terminal-actions"
      {...props}
    />
  );
}

export type TerminalCopyButtonProps = Omit<ButtonProps, "onError"> & {
  onCopy?: () => void;
  onError?: (error: Error) => void;
  timeout?: number;
};

export function TerminalCopyButton({
  children,
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
      size="icon-sm"
      variant="ghost"
      aria-label={copied ? t("agentComponents.copiedOutput") : t("agentComponents.copyOutput")}
      className={`text-terminal-muted hover:bg-terminal-control-hover hover:text-terminal-foreground ${className}`}
      data-slot="terminal-copy-button"
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
      {children ??
        (copied ? (
          <Check className="size-3.5" aria-hidden="true" />
        ) : (
          <Copy className="size-3.5" aria-hidden="true" />
        ))}
    </Button>
  );
}

export type TerminalContentProps = HTMLAttributes<HTMLDivElement>;

const terminalBottomThreshold = 8;

function isTerminalAtBottom(element: HTMLDivElement): boolean {
  return element.scrollHeight - element.clientHeight - element.scrollTop <= terminalBottomThreshold;
}

export function TerminalContent({
  children,
  className = "",
  onScroll,
  ...props
}: TerminalContentProps) {
  const { autoScroll, isStreaming, output } = useTerminalContext();
  const { t } = useTranslation("conversation");
  const contentRef = useRef<HTMLDivElement>(null);
  const followsOutputRef = useRef(true);
  const outputRevision = typeof output === "string" ? output : output.version;

  useEffect(() => {
    if (!autoScroll || !followsOutputRef.current) {
      return;
    }
    const content = contentRef.current;
    if (content !== null) {
      // 仅在用户仍位于底部时跟随增量，避免打断历史输出阅读。
      content.scrollTop = content.scrollHeight;
    }
  }, [autoScroll, outputRevision]);

  return (
    <div
      aria-busy={isStreaming}
      aria-live={isStreaming ? "polite" : "off"}
      className={`max-h-96 overflow-auto overscroll-contain p-3 font-mono text-meta leading-5 ${className}`}
      data-slot="terminal-content"
      onScroll={(event) => {
        onScroll?.(event);
        if (!event.defaultPrevented) {
          followsOutputRef.current = isTerminalAtBottom(event.currentTarget);
        }
      }}
      ref={contentRef}
      {...props}
    >
      <pre className="m-0 whitespace-pre-wrap break-words font-inherit">
        <AnsiOutput output={output} />
        {isStreaming ? (
          <span
            aria-label={t("agentComponents.streamingOutput")}
            className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-terminal-foreground align-middle"
            role="status"
          />
        ) : null}
      </pre>
      {children}
    </div>
  );
}
