import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ButtonHTMLAttributes,
  type ComponentProps,
  type HTMLAttributes,
  type ReactElement,
} from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../core/button.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../core/tooltip.js";

export type MessageFileReference = Readonly<{
  lineNumber: number | null;
  path: string;
}>;

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: "assistant" | "system" | "user";
};

export function Message({ className = "", from, ...props }: MessageProps) {
  return (
    <article
      className={`group/message flex w-full flex-col ${
        from === "user" ? "items-end" : "items-start"
      } ${className}`}
      data-role={from}
      {...props}
    />
  );
}

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export function MessageContent({ className = "", ...props }: MessageContentProps) {
  return (
    <div
      className={`max-w-full text-body leading-6 text-foreground group-data-[role=user]/message:max-w-[var(--ui-layout-message-width)] group-data-[role=user]/message:rounded-surface group-data-[role=user]/message:bg-control group-data-[role=user]/message:px-3.5 group-data-[role=user]/message:py-2.5 ${className}`}
      {...props}
    />
  );
}

export type MessageActionsProps = ComponentProps<"div">;

export function MessageActions({ className = "", ...props }: MessageActionsProps) {
  return <div className={`flex items-center gap-1 ${className}`} {...props} />;
}

export type MessageActionProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label?: string;
  tooltip?: string;
};

export function MessageAction({
  className = "",
  label,
  tooltip,
  type = "button",
  ...props
}: MessageActionProps) {
  const accessibleLabel = label ?? tooltip;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          aria-label={accessibleLabel}
          className={`grid size-7 place-items-center rounded-control text-muted-foreground transition-colors hover:bg-control-hover hover:text-foreground ${className}`}
          type={type}
          {...props}
        />
      </TooltipTrigger>
      {tooltip === undefined ? null : <TooltipContent>{tooltip}</TooltipContent>}
    </Tooltip>
  );
}

type MessageBranchContextValue = Readonly<{
  branches: ReactElement[];
  currentBranch: number;
  goToNext: () => void;
  goToPrevious: () => void;
  setBranches: (branches: ReactElement[]) => void;
  totalBranches: number;
}>;

const MessageBranchContext = createContext<MessageBranchContextValue | null>(null);

function useMessageBranch(): MessageBranchContextValue {
  const context = useContext(MessageBranchContext);

  if (context === null) {
    throw new Error("MessageBranch components must be used within MessageBranch");
  }

  return context;
}

export type MessageBranchProps = HTMLAttributes<HTMLDivElement> & {
  defaultBranch?: number;
  onBranchChange?: (branchIndex: number) => void;
};

export function MessageBranch({
  className = "",
  defaultBranch = 0,
  onBranchChange,
  ...props
}: MessageBranchProps) {
  const [currentBranch, setCurrentBranch] = useState(defaultBranch);
  const [branches, setBranches] = useState<ReactElement[]>([]);

  const handleBranchChange = useCallback(
    (nextBranch: number) => {
      setCurrentBranch(nextBranch);
      onBranchChange?.(nextBranch);
    },
    [onBranchChange],
  );

  const goToPrevious = useCallback(() => {
    const previousBranch = currentBranch > 0 ? currentBranch - 1 : branches.length - 1;
    handleBranchChange(previousBranch);
  }, [branches.length, currentBranch, handleBranchChange]);

  const goToNext = useCallback(() => {
    const nextBranch = currentBranch < branches.length - 1 ? currentBranch + 1 : 0;
    handleBranchChange(nextBranch);
  }, [branches.length, currentBranch, handleBranchChange]);

  const contextValue = useMemo<MessageBranchContextValue>(
    () => ({
      branches,
      currentBranch,
      goToNext,
      goToPrevious,
      setBranches,
      totalBranches: branches.length,
    }),
    [branches, currentBranch, goToNext, goToPrevious],
  );

  return (
    <MessageBranchContext.Provider value={contextValue}>
      <div className={`grid w-full gap-2 [&>div]:pb-0 ${className}`} {...props} />
    </MessageBranchContext.Provider>
  );
}

export type MessageBranchContentProps = HTMLAttributes<HTMLDivElement>;

export function MessageBranchContent({ children, ...props }: MessageBranchContentProps) {
  const { branches, currentBranch, setBranches } = useMessageBranch();
  const branchElements = useMemo(
    () => (Array.isArray(children) ? children : [children]) as ReactElement[],
    [children],
  );

  useEffect(() => {
    // 分支内容由调用方声明，只有数量变化时才同步选择器需要的元数据。
    if (branches.length !== branchElements.length) {
      setBranches(branchElements);
    }
  }, [branchElements, branches.length, setBranches]);

  return branchElements.map((branch, branchIndex) => (
    <div
      className={`grid gap-2 overflow-hidden [&>div]:pb-0 ${
        branchIndex === currentBranch ? "block" : "hidden"
      }`}
      key={branch.key ?? branchIndex}
      {...props}
    >
      {branch}
    </div>
  ));
}

export type MessageBranchSelectorProps = HTMLAttributes<HTMLDivElement>;

export function MessageBranchSelector({ className = "", ...props }: MessageBranchSelectorProps) {
  const { totalBranches } = useMessageBranch();

  if (totalBranches <= 1) {
    return null;
  }

  return <div className={`flex items-center gap-0.5 ${className}`} {...props} />;
}

export type MessageBranchPreviousProps = ButtonHTMLAttributes<HTMLButtonElement>;

export function MessageBranchPrevious({
  children,
  className = "",
  ...props
}: MessageBranchPreviousProps) {
  const { goToPrevious, totalBranches } = useMessageBranch();
  const { t } = useTranslation("conversation");

  return (
    <Button
      variant="ghost"
      aria-label={t("agentComponents.previousBranch")}
      className={`grid size-7 place-items-center rounded-control text-muted-foreground transition-colors hover:bg-control-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40 ${className}`}
      disabled={totalBranches <= 1}
      onClick={goToPrevious}
      type="button"
      {...props}
    >
      {children ?? <ChevronLeft className="size-3.5" aria-hidden="true" />}
    </Button>
  );
}

export type MessageBranchNextProps = ButtonHTMLAttributes<HTMLButtonElement>;

export function MessageBranchNext({ children, className = "", ...props }: MessageBranchNextProps) {
  const { goToNext, totalBranches } = useMessageBranch();
  const { t } = useTranslation("conversation");

  return (
    <Button
      variant="ghost"
      aria-label={t("agentComponents.nextBranch")}
      className={`grid size-7 place-items-center rounded-control text-muted-foreground transition-colors hover:bg-control-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40 ${className}`}
      disabled={totalBranches <= 1}
      onClick={goToNext}
      type="button"
      {...props}
    >
      {children ?? <ChevronRight className="size-3.5" aria-hidden="true" />}
    </Button>
  );
}

export type MessageBranchPageProps = HTMLAttributes<HTMLSpanElement>;

export function MessageBranchPage({ className = "", ...props }: MessageBranchPageProps) {
  const { currentBranch, totalBranches } = useMessageBranch();

  return (
    <span className={`px-1 text-label text-muted-foreground ${className}`} {...props}>
      {currentBranch + 1} / {totalBranches}
    </span>
  );
}

export type MessageToolbarProps = ComponentProps<"div">;

export function MessageToolbar({ className = "", ...props }: MessageToolbarProps) {
  return (
    <div
      className={`mt-4 flex w-full items-center justify-between gap-4 ${className}`}
      {...props}
    />
  );
}
