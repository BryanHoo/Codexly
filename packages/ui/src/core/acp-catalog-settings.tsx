import { SettingsActions } from "./settings-group.js";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invalidateAcpPreviews } from "./acp-preview-cache.js";
import { v4 as uuid } from "uuid";
import type { AcpAgentCatalogPage, AcpAgentRegistration, AgentEngine } from "@codexly/protocol";
import { Button } from "./button.js";
import { Input } from "./input.js";
import { AgentEngineIcon } from "./agent-engine-icon.js";
import { SettingsSaveStatus } from "./settings-save-status.js";
import {
  AcpStage,
  useAcpCatalogProgress,
  type AcpCatalogProgressReader,
} from "./acp-catalog-progress.js";

type CatalogMutation = (
  engine: AgentEngine,
  options?: { idempotencyKey?: string },
) => Promise<AcpAgentCatalogPage>;
export interface AcpCatalogClient extends AcpCatalogProgressReader {
  getAcpAgentCatalog(options?: {
    signal?: AbortSignal;
    refresh?: boolean;
  }): Promise<AcpAgentCatalogPage>;
  installAcpAgent: CatalogMutation;
  updateAcpAgent: CatalogMutation;
  removeAcpAgent: CatalogMutation;
  configureAcpAgent(
    input: AcpAgentRegistration,
    options?: { idempotencyKey?: string },
  ): Promise<AcpAgentCatalogPage>;
}
const key = ["acp-agent-catalog"] as const;
const addableEngines: readonly AgentEngine[] = [
  "codex",
  "claude",
  "acp-antigravity-acp",
  "acp-codefree-o",
  "acp-opencode",
];
/** 添加弹窗独立于原有配置面板；安装成功后只更新目录并选择新增 Agent。 */
export function AcpAgentPicker({
  client,
  language,
  onAdded,
  onPendingChange,
}: Readonly<{
  client: Partial<AcpCatalogClient>;
  language: "zh-CN" | "en";
  onAdded: (engine: AgentEngine) => void;
  onPendingChange: (pending: boolean) => void;
}>) {
  const zh = language === "zh-CN";
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      client.getAcpAgentCatalog?.({ signal }) ?? Promise.reject(new Error("ACP unavailable")),
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState<AgentEngine>();
  const progress = useAcpCatalogProgress(client, installing !== undefined);
  const [error, setError] = useState<string>();
  const pending = useRef<Promise<boolean> | undefined>(undefined);
  const retry = useRef<(() => void) | undefined>(undefined);
  const run = (engine: AgentEngine, action: () => Promise<AcpAgentCatalogPage>) => {
    if (pending.current) return;
    retry.current = () => {
      run(engine, action);
    };
    setBusy(true);
    setInstalling(engine);
    onPendingChange(true);
    setError(undefined);
    // 不取消工作区的后台发现；发现完成后仍需同步其他自动安装的 Agent。
    pending.current = Promise.resolve()
      .then(action)
      .then(async (page) => {
        await invalidateAcpPreviews(cache, engine);
        cache.setQueryData(key, page);
        onAdded(engine);
        return true;
      })
      .catch(() => {
        setError(zh ? "安装失败，请重试" : "Installation failed. Try again.");
        return false;
      })
      .finally(() => {
        setBusy(false);
        setInstalling(undefined);
        onPendingChange(false);
        pending.current = undefined;
      });
  };
  return (
    <section className="flex min-h-0 flex-col gap-4">
      <SettingsSaveStatus
        status={error ? "error" : "idle"}
        labels={{
          saving: zh ? "正在保存…" : "Saving…",
          saved: zh ? "已保存" : "Saved",
          saveError: zh ? "保存失败" : "Save failed",
          retry: zh ? "重试" : "Retry",
        }}
        onRetry={() => {
          retry.current?.();
        }}
        beforeLeave={() => pending.current ?? Promise.resolve(true)}
      />
      {error ? <p role="alert">{error}</p> : null}
      {query.isError ? (
        <SettingsActions>
          <Button
            variant="ghost"
            onClick={() => {
              void query.refetch();
            }}
          >
            {zh ? "重试" : "Retry"}
          </Button>
        </SettingsActions>
      ) : null}
      {!query.data && !query.isError ? <p role="status">{zh ? "加载中…" : "Loading…"}</p> : null}
      {/* 搜索框留在滚动区外，四周完整显示键盘焦点描边。 */}
      <Input
        type="search"
        variant="outline"
        className="shrink-0"
        aria-label={zh ? "搜索 Agent" : "Search agents"}
        placeholder={zh ? "搜索 Agent" : "Search agents"}
        disabled={busy}
        value={filter}
        onChange={(event) => {
          setFilter(event.target.value);
        }}
      />
      <div className="min-h-0 space-y-4 overflow-y-auto">
        {/* 只开放指定的五个 Agent，按固定顺序查找，避免受宿主目录顺序影响。 */}
        {addableEngines
          .flatMap((engine) => {
            const agent = query.data?.agents.find((entry) => entry.engine === engine);
            return agent &&
              !agent.installed &&
              agent.name.toLowerCase().includes(filter.toLowerCase())
              ? [agent]
              : [];
          })
          .map((agent) => (
            <div
              key={agent.engine}
              className="flex flex-wrap items-center gap-3 rounded-control border border-separator p-3"
            >
              <h3 className="mr-auto flex items-center gap-2 font-medium">
                <AgentEngineIcon engine={agent.engine} />
                {agent.name}
              </h3>
              <span className="text-label text-muted-foreground">{agent.version}</span>
              <Button
                disabled={busy}
                onClick={() => {
                  run(
                    agent.engine,
                    () =>
                      client.installAcpAgent?.(agent.engine, { idempotencyKey: uuid() }) ??
                      Promise.reject(new Error("ACP unavailable")),
                  );
                }}
              >
                {installing === agent.engine
                  ? zh
                    ? "正在安装…"
                    : "Installing…"
                  : zh
                    ? "安装"
                    : "Install"}
              </Button>
              {installing === agent.engine ? (
                <AcpStage
                  zh={zh}
                  progress={
                    progress?.operations.find((operation) => operation.engine === agent.engine)
                      ?.progress
                  }
                />
              ) : null}
            </div>
          ))}
      </div>
    </section>
  );
}
