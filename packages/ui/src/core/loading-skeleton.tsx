import { cn } from "../lib/utils.js";
import { Skeleton } from "./skeleton.js";

type LoadingSkeletonVariant =
  "list" | "conversation" | "settings" | "cards" | "statistics" | "workspace" | "code";
type LoadingSkeletonProps = Readonly<{
  label: string;
  variant?: LoadingSkeletonVariant;
  className?: string;
}>;

const rows = ["w-3/4", "w-1/2", "w-2/3", "w-4/5", "w-3/5"] as const;

function ListSkeleton() {
  return (
    <div className="space-y-1">
      {rows.map((width) => (
        <div key={width} className="flex min-h-10 items-center gap-3 py-2">
          <Skeleton className="size-4 shrink-0 rounded-sm" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className={cn("h-2.5", width)} />
            <Skeleton className="h-2 w-1/3 opacity-60" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ConversationSkeleton() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 py-3">
      <div className="ml-auto w-2/3 space-y-3 rounded-xl bg-control p-4">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
      </div>
      <div className="space-y-4">
        <Skeleton className="h-3 w-24" />
        <div className="space-y-3">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-11/12" />
          <Skeleton className="h-3 w-3/4" />
        </div>
      </div>
      <div className="space-y-3 opacity-60">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}

function SettingsSkeleton() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-8">
      <div className="space-y-3">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-3 w-2/3" />
      </div>
      {[0, 1, 2, 3].map((row) => (
        <div
          key={row}
          className="flex min-h-16 items-center gap-6 border-b border-separator/60 pb-5"
        >
          <div className="min-w-0 flex-1 space-y-3">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-2.5 w-3/4 opacity-60" />
          </div>
          <Skeleton
            className={
              row % 2 === 0 ? "h-5 w-9 shrink-0 rounded-full" : "h-8 w-20 shrink-0 rounded-control"
            }
          />
        </div>
      ))}
    </div>
  );
}

function CardsSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {[0, 1, 2, 3, 4, 5].map((card) => (
        <div key={card} className="min-w-0 space-y-5 rounded-xl border border-separator/60 p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="size-8 shrink-0 rounded-lg" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <div className="space-y-2.5">
            <Skeleton className="h-2.5 w-full" />
            <Skeleton className="h-2.5 w-3/4" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full opacity-60" />
        </div>
      ))}
    </div>
  );
}

function StatisticsSkeleton() {
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
        {[0, 1, 2, 3].map((metric) => (
          <div key={metric} className="space-y-4">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-9 w-3/4" />
            <Skeleton className="h-2 w-12 opacity-60" />
          </div>
        ))}
      </div>
      <div className="space-y-4 rounded-xl border border-separator/60 p-4">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-32 w-full opacity-60" />
      </div>
      <ListSkeleton />
    </div>
  );
}

function WorkspaceSkeleton() {
  return (
    <div className="flex h-full min-h-0">
      <div className="hidden w-60 shrink-0 space-y-7 border-r border-separator/60 p-4 md:block">
        <Skeleton className="h-7 w-28" />
        <ListSkeleton />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-6 p-4 sm:p-6">
        <Skeleton className="h-5 w-32" />
        <div className="min-h-0 flex-1 overflow-hidden">
          <ConversationSkeleton />
        </div>
        <Skeleton className="mx-auto h-24 w-full max-w-3xl shrink-0 rounded-xl" />
      </div>
    </div>
  );
}

function CodeSkeleton() {
  return (
    <div className="space-y-3 py-2">
      {[...rows, ...rows].map((width, line) => (
        <div key={line} className="flex items-center gap-5">
          <Skeleton className="h-2 w-3 shrink-0 opacity-40" />
          <Skeleton className={cn("h-2.5", width)} />
        </div>
      ))}
    </div>
  );
}

/** 只在内容尚不可用时挂载；固定骨架数量，避免按数据规模创建节点或订阅状态。
 * 整个占位区只播报一条本地化状态，装饰图形隐藏且不产生任何可聚焦控件。
 */
export function LoadingSkeleton({ label, variant = "list", className }: LoadingSkeletonProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      data-slot="loading-skeleton"
      data-variant={variant}
      className={cn("w-full min-w-0", variant === "workspace" ? "h-full" : "p-4", className)}
    >
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className={variant === "workspace" ? "h-full" : undefined}>
        {variant === "workspace" ? (
          <WorkspaceSkeleton />
        ) : variant === "conversation" ? (
          <ConversationSkeleton />
        ) : variant === "settings" ? (
          <SettingsSkeleton />
        ) : variant === "cards" ? (
          <CardsSkeleton />
        ) : variant === "statistics" ? (
          <StatisticsSkeleton />
        ) : variant === "code" ? (
          <CodeSkeleton />
        ) : (
          <ListSkeleton />
        )}
      </div>
    </div>
  );
}
