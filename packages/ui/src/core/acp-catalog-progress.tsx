import { useQuery } from "@tanstack/react-query";
import type { AcpAgentCatalogProgress, AcpAgentInstallationStage } from "@codexly/protocol";
import { Progress } from "./progress.js";

export interface AcpCatalogProgressReader {
  getAcpAgentCatalogProgress(options?: { signal?: AbortSignal }): Promise<AcpAgentCatalogProgress>;
}

// 两端使用同一个轻量快照查询，只在发现或用户操作进行期间读取。
export function useAcpCatalogProgress(client: Partial<AcpCatalogProgressReader>, active: boolean) {
  const enabled = active && !!client.getAcpAgentCatalogProgress;
  const query = useQuery({
    queryKey: ["acp-agent-catalog-progress"],
    queryFn: ({ signal }) =>
      client.getAcpAgentCatalogProgress?.({ signal }) ?? Promise.resolve({ operations: [] }),
    enabled,
    refetchInterval: enabled ? 750 : false,
    refetchOnWindowFocus: false,
    retry: false,
    gcTime: 0,
  });
  return enabled && !query.isError ? query.data : undefined;
}

const stages = {
  preparing: ["正在准备", "Preparing"],
  installing: ["正在安装依赖", "Installing dependencies"],
  downloading: ["正在下载安装包", "Downloading package"],
  verifying: ["正在校验安装包", "Verifying package"],
  extracting: ["正在解压安装包", "Extracting package"],
  publishing: ["正在保存安装结果", "Saving installation"],
  removing: ["正在移除", "Removing"],
} as const;

export function acpStage(progress: AcpAgentInstallationStage | undefined, zh: boolean) {
  const label = stages[progress?.stage ?? "preparing"][zh ? 0 : 1];
  if (progress?.stage !== "downloading") return { label };
  if (progress.total && progress.received <= progress.total) {
    const percent = Math.floor((progress.received / progress.total) * 100);
    return { label, percent, detail: `${String(percent)}%` };
  }
  if (!progress.received) return { label };
  const detail =
    progress.received < 1024 * 1024
      ? `${String(Math.max(1, Math.floor(progress.received / 1024)))} KiB`
      : `${(progress.received / (1024 * 1024)).toFixed(1)} MiB`;
  return { label, detail };
}

export function AcpStage({
  progress,
  zh,
}: Readonly<{ progress?: AcpAgentInstallationStage | undefined; zh: boolean }>) {
  const { label, percent, detail } = acpStage(progress, zh);
  return (
    <div className="w-full min-w-0 space-y-1.5 text-label text-muted-foreground">
      <p className="flex flex-wrap justify-between gap-x-2">
        <span role="status">{label}</span>
        {detail ? <span className="tabular-nums">{detail}</span> : null}
      </p>
      {percent === undefined ? null : <Progress value={percent} aria-label={label} />}
    </div>
  );
}
