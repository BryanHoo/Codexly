import { cn } from "../lib/utils.js";
import { TraceStatusIcon, type TraceStatus } from "../core/trace-status.js";
import { Wrench } from "lucide-react";
import {
  isValidElement,
  useState,
  type ComponentProps,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleTrigger,
  TraceCollapsibleContent,
  TraceLine,
  TraceIcon,
  TraceTitle,
  TraceDescription,
} from "../core/trace.js";
import { CodeBlock, CodeBlockContent } from "../core/code-block.js";
import { useAgentTranslation } from "./locale.js";
export type ToolState =
  | "approval-requested"
  | "approval-responded"
  | "input-available"
  | "input-streaming"
  | "output-available"
  | "output-denied"
  | "output-error";
export function Tool({
  children,
  defaultOpen = false,
  isStreaming,
  className,
  ...props
}: ComponentProps<"div"> & { defaultOpen?: boolean; isStreaming?: boolean }) {
  const [userOpen, setUserOpen] = useState<boolean | undefined>(undefined);
  return (
    <Trace className={className}>
      <TraceCollapsible
        {...(isStreaming === undefined
          ? { defaultOpen }
          : { open: userOpen ?? isStreaming, onOpenChange: setUserOpen })}
        {...props}
      >
        {children}
      </TraceCollapsible>
    </Trace>
  );
}
const statusKeys: Record<ToolState, string> = {
  "approval-requested": "waitingApproval",
  "approval-responded": "responded",
  "input-available": "running",
  "input-streaming": "running",
  "output-available": "completed",
  "output-denied": "denied",
  "output-error": "error",
};
export function ToolHeader({
  duration,
  icon,
  state,
  title,
  className,
  ...props
}: HTMLAttributes<HTMLElement> & {
  duration?: ReactNode;
  icon?: ReactNode;
  state?: ToolState;
  title: string;
}) {
  const { t } = useAgentTranslation();
  const status =
    state === "output-error"
      ? "error"
      : state === "input-available" || state === "input-streaming"
        ? "running"
        : state === "approval-requested"
          ? "pending"
          : undefined;
  const iconStatus: TraceStatus | undefined =
    state === "output-available"
      ? "completed"
      : state === "output-denied"
        ? "denied"
        : state === "approval-requested"
          ? "waiting"
          : state === "approval-responded"
            ? "responded"
            : status;
  const accessibleLabel =
    state === undefined ? title : `${t(`agentComponents.status.${statusKeys[state]}`)} · ${title}`;
  return (
    <TraceCollapsibleTrigger aria-label={accessibleLabel} className={className} {...props}>
      <TraceLine {...(status === undefined ? {} : { status })}>
        <TraceIcon>
          <TraceStatusIcon status={iconStatus} fallback={icon ?? <Wrench />} />
        </TraceIcon>
        <TraceTitle>{title}</TraceTitle>
        {duration === undefined ? null : <TraceDescription>{duration}</TraceDescription>}
      </TraceLine>
    </TraceCollapsibleTrigger>
  );
}
export function ToolBody({ children }: { children: ReactNode }) {
  // Radix Presence 在退出动画结束后卸载详情，关闭期间仍保留可完成的过渡。
  return <TraceCollapsibleContent>{children}</TraceCollapsibleContent>;
}
export function ToolContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <ToolBody>
      <div className={cn("space-y-3", className)} {...props} />
    </ToolBody>
  );
}
function formatJson(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
export type ToolInputProps = HTMLAttributes<HTMLDivElement> & { input: unknown };
export function ToolInput({ input, ...props }: ToolInputProps) {
  const { t } = useAgentTranslation();
  return (
    <div {...props}>
      <span className="mb-1 block text-label">{t("agentComponents.toolInput")}</span>
      <CodeBlock size="sm" data-language="json">
        <CodeBlockContent wrap className="max-h-80">
          {formatJson(input)}
        </CodeBlockContent>
      </CodeBlock>
    </div>
  );
}
export type ToolOutputProps = HTMLAttributes<HTMLDivElement> & {
  errorText: string | undefined;
  output: unknown;
};
export function ToolOutput({ errorText, output, ...props }: ToolOutputProps) {
  const { t } = useAgentTranslation();
  if (output === undefined && errorText === undefined) return null;
  return (
    <div {...props}>
      <span className="mb-1 block text-label">
        {t(errorText === undefined ? "agentComponents.toolResult" : "agentComponents.toolError")}
      </span>
      {isValidElement(output) && errorText === undefined ? (
        output
      ) : (
        <CodeBlock
          size="sm"
          data-language="json"
          variant={errorText === undefined ? "default" : "destructive"}
        >
          <CodeBlockContent wrap className="max-h-96">
            {errorText ?? formatJson(output)}
          </CodeBlockContent>
        </CodeBlock>
      )}
    </div>
  );
}
