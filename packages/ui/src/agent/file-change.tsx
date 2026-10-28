import { ChevronRight, FilePenLine, FilePlus2, FileX2 } from "lucide-react";
import type { ComponentProps } from "react";

import { TraceDescription, TraceIcon, TraceLine, TraceTitle } from "../core/trace.js";
import { cn } from "../lib/utils.js";

type FileChangeProps = Omit<ComponentProps<"button">, "children"> & {
  additions: number;
  kind: "create" | "delete" | "update";
  name: string;
  operation: string;
  removals: number;
};

// 遵循 AI Elements 的文件 Trace 组合；两端只注入文案、统计和打开差异的动作。
export function FileChange({
  additions,
  className,
  kind,
  name,
  operation,
  removals,
  ...props
}: FileChangeProps) {
  const Icon = kind === "create" ? FilePlus2 : kind === "delete" ? FileX2 : FilePenLine;

  return (
    <button
      aria-haspopup="dialog"
      className={cn(
        "agent-trace-trigger flex w-fit max-w-full min-w-0 cursor-pointer items-center gap-1 rounded-control text-left text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-brand/50",
        className,
      )}
      data-file-change={kind}
      type="button"
      {...props}
    >
      <TraceLine>
        <TraceIcon>
          <Icon />
        </TraceIcon>
        <TraceTitle>
          {operation} {name}
        </TraceTitle>
        {/* 统计不参与截断，窄屏优先缩略文件名，始终保留正负号与语义颜色。 */}
        <TraceDescription className="flex items-center gap-2">
          <span className="text-diff-added">+{additions}</span>
          <span className="text-diff-removed">-{removals}</span>
        </TraceDescription>
      </TraceLine>
      <TraceIcon className="text-subtle-foreground">
        <ChevronRight />
      </TraceIcon>
    </button>
  );
}
