import type { AgentThreadMemory } from "@codexly/protocol";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Button } from "./button.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.js";

export interface ThreadMemoryClient {
  readThreadMemory?(
    projectId: string,
    taskId: string,
    options?: { signal?: AbortSignal },
  ): Promise<AgentThreadMemory>;
}
export const threadMemoryLabels = {
  zh: { title: "会话记忆摘要", refresh: "刷新记忆摘要" },
  en: { title: "Session memory summary", refresh: "Refresh memory summary" },
};

export function ThreadMemorySection({
  client,
  projectId,
  taskId,
  revision,
  labels,
}: Readonly<{
  client: ThreadMemoryClient;
  projectId: string;
  taskId: string;
  revision: string;
  labels: typeof threadMemoryLabels.en;
}>) {
  const query = useQuery({
    queryKey: ["projects", projectId, "tasks", taskId, "memory", revision],
    queryFn: ({ signal }) =>
      client.readThreadMemory?.(projectId, taskId, { signal }) ??
      Promise.resolve({ status: "unsupported", summary: null } as const),
    // 仅由可见上下文挂载；不轮询、不自动重试、不持久化私密摘要。切换会话立即清理旧缓存。
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const data = query.data;
  // 没有可读内容就不占据面板空间；刷新失败时保留已有摘要，用户仍可通过图标重试。
  if (data?.status !== "ready" || !data.summary?.trim()) return null;

  return (
    <section aria-label={labels.title} aria-busy={query.isFetching} className="min-w-0">
      <div className="mb-1 flex min-h-7 items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-foreground">{labels.title}</h3>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={labels.refresh}
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={query.isFetching}
              onClick={() => {
                void query.refetch();
              }}
            >
              <RefreshCw
                aria-hidden="true"
                className={query.isFetching ? "animate-spin motion-reduce:animate-none" : undefined}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{labels.refresh}</TooltipContent>
        </Tooltip>
      </div>
      {/* 摘要按纯文本保留原始内容和换行，避免加载正文中的外部资源。 */}
      <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded-control bg-control-hover p-2 font-sans text-caption">
        {data.summary}
      </pre>
    </section>
  );
}
