import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { v4 as uuid } from "uuid";
import type { AcpAgentCatalogPage, AcpAgentRegistration, AgentEngine } from "@codexly/protocol";
import { Button } from "./button.js";
import { Input } from "./input.js";
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
  const [draft, setDraft] = useState<{
    name: string;
    command: string;
    args: string;
    env: string;
    replaceEnv: boolean;
    engine: AgentEngine;
  }>();
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState<AgentEngine>();
  const progress = useAcpCatalogProgress(client, installing !== undefined);
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const pending = useRef<Promise<boolean> | undefined>(undefined);
  const retry = useRef<(() => void) | undefined>(undefined);
  const run = (
    engine: AgentEngine,
    action: () => Promise<AcpAgentCatalogPage>,
    install = false,
  ) => {
    if (pending.current) return;
    retry.current = () => {
      run(engine, action, install);
    };
    setBusy(true);
    if (install) setInstalling(engine);
    onPendingChange(true);
    setStatus(install ? "idle" : "saving");
    setError(undefined);
    // 不取消工作区的后台发现；发现完成后仍需同步其他自动安装的 Agent。
    pending.current = Promise.resolve()
      .then(action)
      .then((page) => {
        cache.setQueryData(key, page);
        if (!install) setStatus("saved");
        setDraft(undefined);
        onAdded(engine);
        return true;
      })
      .catch(() => {
        setError(
          install
            ? zh
              ? "安装失败，请重试"
              : "Installation failed. Try again."
            : zh
              ? "添加失败，请重试"
              : "Could not add agent. Retry.",
        );
        if (!install) setStatus("error");
        return false;
      })
      .finally(() => {
        setBusy(false);
        setInstalling(undefined);
        onPendingChange(false);
        pending.current = undefined;
      });
  };
  const submit = () => {
    if (!draft) return;
    try {
      const args: unknown = JSON.parse(draft.args),
        env: unknown = JSON.parse(draft.env);
      if (
        !Array.isArray(args) ||
        !args.every((value) => typeof value === "string") ||
        !env ||
        typeof env !== "object" ||
        Array.isArray(env) ||
        !Object.values(env).every((value) => typeof value === "string")
      )
        throw new Error("invalid");
      const input: AcpAgentRegistration = {
        engine: draft.engine,
        name: draft.name,
        command: draft.command,
        args,
        enabled: true,
        ...(draft.replaceEnv ? { env: env as Record<string, string> } : {}),
      };
      run(
        draft.engine,
        () =>
          client.configureAcpAgent?.(input, { idempotencyKey: uuid() }) ??
          Promise.reject(new Error("ACP unavailable")),
      );
    } catch {
      setError(zh ? "参数或环境变量格式无效" : "Invalid arguments or environment variables.");
    }
  };
  return (
    <section className="flex min-h-0 flex-col gap-4">
      <SettingsSaveStatus
        status={status}
        labels={{
          saving: zh ? "正在保存…" : "Saving…",
          saved: zh ? "已保存" : "Saved",
          saveError: zh ? "保存失败" : "Save failed",
          retry: zh ? "重试" : "Retry",
        }}
        onRetry={() => {
          retry.current?.();
        }}
        beforeLeave={() => pending.current ?? Promise.resolve(!draft)}
      />
      {error ? <p role="alert">{error}</p> : null}
      {query.isError ? (
        <Button
          variant="ghost"
          onClick={() => {
            void query.refetch();
          }}
        >
          {zh ? "重试" : "Retry"}
        </Button>
      ) : null}
      {!query.data && !query.isError ? <p role="status">{zh ? "加载中…" : "Loading…"}</p> : null}
      {/* 搜索框留在滚动区外，四周完整显示键盘焦点描边。 */}
      {!draft ? (
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
      ) : null}
      <div className="min-h-0 space-y-4 overflow-y-auto">
        {!draft ? (
          <>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setDraft({
                  engine: `acp-custom-${uuid().slice(0, 8)}`,
                  name: "",
                  command: "",
                  args: "[]",
                  env: "{}",
                  replaceEnv: false,
                });
              }}
            >
              {zh ? "配置自定义 Agent" : "Configure custom agent"}
            </Button>
            {query.data?.agents
              .filter(
                (agent) =>
                  !agent.installed && agent.name.toLowerCase().includes(filter.toLowerCase()),
              )
              .map((agent) => (
                <div
                  key={agent.engine}
                  className="flex flex-wrap items-center gap-3 rounded-control border border-separator p-3"
                >
                  <h3 className="mr-auto font-medium">{agent.name}</h3>
                  <span className="text-label text-muted-foreground">{agent.version}</span>
                  <Button
                    disabled={busy}
                    onClick={() => {
                      run(
                        agent.engine,
                        () =>
                          client.installAcpAgent?.(agent.engine, { idempotencyKey: uuid() }) ??
                          Promise.reject(new Error("ACP unavailable")),
                        true,
                      );
                    }}
                  >
                    {installing === agent.engine
                      ? zh
                        ? "正在安装…"
                        : "Installing…"
                      : zh
                        ? "安装并启用"
                        : "Install and enable"}
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
          </>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              submit();
            }}
          >
            <label className="block">
              {zh ? "名称" : "Name"}
              <Input
                required
                maxLength={128}
                value={draft.name}
                onChange={(event) => {
                  setDraft({ ...draft, name: event.target.value });
                }}
              />
            </label>
            <label className="block">
              {zh ? "可执行程序路径" : "Executable path"}
              <Input
                required
                value={draft.command}
                onChange={(event) => {
                  setDraft({ ...draft, command: event.target.value });
                }}
              />
            </label>
            <label className="block">
              {zh ? "参数（JSON 数组）" : "Arguments (JSON array)"}
              <Input
                value={draft.args}
                onChange={(event) => {
                  setDraft({ ...draft, args: event.target.value });
                }}
              />
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.replaceEnv}
                onChange={(event) => {
                  setDraft({ ...draft, replaceEnv: event.target.checked });
                }}
              />
              {zh ? "替换环境变量" : "Replace environment variables"}
            </label>
            {draft.replaceEnv ? (
              <label className="block">
                {zh ? "环境变量" : "Environment variables"}
                <Input
                  type="password"
                  autoComplete="off"
                  value={draft.env}
                  onChange={(event) => {
                    setDraft({ ...draft, env: event.target.value });
                  }}
                />
              </label>
            ) : null}
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>
                {zh ? "保存配置" : "Save configuration"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setDraft(undefined);
                }}
              >
                {zh ? "取消" : "Cancel"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
