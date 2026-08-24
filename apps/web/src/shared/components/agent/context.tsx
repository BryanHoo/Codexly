import { createContext, useContext, useMemo } from "react";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

import { i18n, useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../core/button.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../core/tooltip.js";

type ContextValue = Readonly<{
  maxTokens: number | null | undefined;
  usedTokens: number | undefined;
}>;

const ContextValueContext = createContext<ContextValue | null>(null);

function useContextValue(): ContextValue {
  const value = useContext(ContextValueContext);
  if (value === null) {
    throw new Error("Context components must be used within Context");
  }
  return value;
}

export type ContextProps = Readonly<
  HTMLAttributes<HTMLSpanElement> & {
    maxTokens?: number | null | undefined;
    usedTokens?: number | undefined;
  }
>;

export function Context({
  children,
  className = "",
  maxTokens,
  usedTokens,
  ...props
}: ContextProps) {
  const value = useMemo(() => ({ maxTokens, usedTokens }), [maxTokens, usedTokens]);

  return (
    <ContextValueContext.Provider value={value}>
      <span className={`inline-flex shrink-0 ${className}`} {...props}>
        {children}
      </span>
    </ContextValueContext.Provider>
  );
}

type FormattedContextUsage = Readonly<{
  accessibleLabel: string;
  percentage: number | null;
  summary: string;
  tokenCount: string | null;
}>;

export function formatContextUsage(usage: ContextValue): FormattedContextUsage {
  const { maxTokens, usedTokens } = usage;
  if (maxTokens === null || maxTokens === undefined || maxTokens <= 0 || usedTokens === undefined) {
    return {
      accessibleLabel: i18n.t("agentComponents.contextUnknown", { ns: "conversation" }),
      percentage: null,
      summary: i18n.t("agentComponents.contextWaiting", { ns: "conversation" }),
      tokenCount: usedTokens === undefined ? null : `${formatCompactTokenCount(usedTokens)} tokens`,
    };
  }

  // Provider 可能短暂上报越界值，展示层将进度限制在有效百分比范围内。
  const percentage = Math.min(100, Math.max(0, Math.round((usedTokens / maxTokens) * 100)));
  return {
    accessibleLabel: i18n.t("agentComponents.contextPercent", {
      ns: "conversation",
      percentage,
    }),
    percentage,
    summary: i18n.t("agentComponents.contextSummary", { ns: "conversation", percentage }),
    tokenCount: `${formatCompactTokenCount(usedTokens)} / ${formatCompactTokenCount(maxTokens)} tokens`,
  };
}

function formatCompactTokenCount(tokenCount: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    notation: "compact",
  }).format(tokenCount);
}

const contextRingRadius = 7;
const contextRingCircumference = 2 * Math.PI * contextRingRadius;

function ContextIcon() {
  useTranslation("conversation");
  const usage = formatContextUsage(useContextValue());
  const completedPercentage = usage.percentage ?? 0;
  const ringOffset = contextRingCircumference * (1 - completedPercentage / 100);

  return (
    <svg className="size-4.5 -rotate-90" viewBox="0 0 20 20" aria-hidden="true">
      <circle
        cx="10"
        cy="10"
        fill="none"
        r={contextRingRadius}
        stroke="currentColor"
        strokeOpacity="0.24"
        strokeWidth="3"
      />
      <circle
        cx="10"
        cy="10"
        fill="none"
        r={contextRingRadius}
        stroke="currentColor"
        strokeDasharray={contextRingCircumference}
        strokeDashoffset={ringOffset}
        strokeLinecap="round"
        strokeWidth="3"
      />
    </svg>
  );
}

export type ContextContentProps = Readonly<HTMLAttributes<HTMLSpanElement>>;

export function ContextContent({ children, className = "", ...props }: ContextContentProps) {
  return (
    <span className={`flex flex-col gap-0.5 px-0.5 py-0.5 tabular-nums ${className}`} {...props}>
      {children}
    </span>
  );
}

export type ContextContentHeaderProps = Readonly<HTMLAttributes<HTMLSpanElement>>;

export function ContextContentHeader({
  children,
  className = "",
  ...props
}: ContextContentHeaderProps) {
  useTranslation("conversation");
  const usage = formatContextUsage(useContextValue());

  return (
    <span className={`contents ${className}`} {...props}>
      {children ?? (
        <>
          <span className="text-body-small font-medium">{usage.summary}</span>
          {usage.tokenCount === null ? null : (
            <span className="text-label text-muted-foreground">{usage.tokenCount}</span>
          )}
        </>
      )}
    </span>
  );
}

export type ContextTriggerProps = Readonly<
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
    children?: ReactNode;
  }
>;

export function ContextTrigger({ children, className = "", ...props }: ContextTriggerProps) {
  useTranslation("conversation");
  const usage = formatContextUsage(useContextValue());

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          {...props}
          aria-label={usage.accessibleLabel}
          className={className}
          size="icon-sm"
          type={props.type ?? "button"}
          variant="ghost"
        >
          {children ?? <ContextIcon />}
        </Button>
      </TooltipTrigger>
      <TooltipContent className="bg-raised text-foreground">
        <ContextContent>
          <ContextContentHeader />
        </ContextContent>
      </TooltipContent>
    </Tooltip>
  );
}
