import { QueryObserver, type QueryClient } from "@tanstack/react-query";
import type { AcpConfigPreview, AcpConfigPreviewRequest, AgentEngine } from "@codexly/protocol";

const freshFor = 5 * 60_000;
const retainFor = 10 * 60_000;

export function invalidateAcpPreviews(cache: QueryClient, engine: AgentEngine): Promise<void> {
  // 先中止旧设置下正在读取的预览，避免迟到的旧数据重新成为有效缓存。
  const filters = { queryKey: ["acp-preview", engine] };
  return cache.cancelQueries(filters).then(() =>
    cache.invalidateQueries({
      ...filters,
      refetchType: "none",
    }),
  );
}

export async function readAcpPreview(
  cache: QueryClient | undefined,
  engine: AgentEngine,
  projectId: string,
  workspace: string,
  request: AcpConfigPreviewRequest,
  signal: AbortSignal,
  load: (request: AcpConfigPreviewRequest, signal: AbortSignal) => Promise<AcpConfigPreview>,
): Promise<AcpConfigPreview> {
  signal.throwIfAborted();
  const input = {
    ...request,
    ...(workspace && projectId !== "temporary" ? { workspacePath: workspace } : {}),
  };
  if (!cache || input.change || Object.keys(input.values).length) return load(input, signal);

  const scope = ["acp-preview", engine, projectId, workspace];
  // 已读取的完整草稿预览也能提供模型，浏览标签时直接复用。
  if (!input.includeCommands) {
    const full = cache.getQueryState<AcpConfigPreview>([...scope, true]);
    if (full?.data && !full.isInvalidated && Date.now() - full.dataUpdatedAt < freshFor)
      return full.data;
  }
  const queryKey = [...scope, input.includeCommands === true];
  const options = {
    queryKey,
    staleTime: freshFor,
    gcTime: retainFor,
    retry: false,
    queryFn: ({ signal }: { signal: AbortSignal }) => load(input, signal),
  };
  // 每个使用方分别订阅。最后一个使用方离开时才取消共享请求。
  const observer = new QueryObserver(cache, { ...options, enabled: false });
  const unsubscribe = observer.subscribe(() => undefined);
  const abort = () => {
    unsubscribe();
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    const result = await cache.fetchQuery(options);
    signal.throwIfAborted();
    return result;
  } finally {
    signal.removeEventListener("abort", abort);
    unsubscribe();
  }
}
