import { Plus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./dialog.js";
import { toast } from "./notifications.js";
import { AcpAgentPicker, type AcpCatalogClient } from "./acp-catalog-settings.js";
import { AcpAgentMaintenance } from "./acp-agent-maintenance.js";
import { invalidateAcpPreviews } from "./acp-preview-cache.js";
import { SettingsGroup } from "./settings-group.js";
import { useState, useRef, useContext, useEffect, useSyncExternalStore } from "react";
import { skipToken, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  hasAcpAgentConnection,
  type AcpAgentProfile,
  type AgentEngine,
  type AcpAgentCatalogPage,
} from "@codexly/protocol";
import { AgentEngineIcon } from "./agent-engine-icon.js";
import { AcpAuthSettings, type AcpAuthClient } from "./acp-auth-settings.js";
import {
  AcpDefaultSettings,
  acpDefaultSettingsLabels,
  type AcpDefaultsClient,
} from "./acp-default-settings.js";
import type { AcpConfigOptionsProps } from "./acp-config-options.js";
import { AcpEngineSettingsGate } from "./acp-engine-settings-gate.js";
import { EngineActivationContext, useSelectedEngines } from "./engine-selection.js";
import { useSettingsNavigation } from "./settings-save-status.js";
import { Button } from "./button.js";
import { Switch } from "./switch.js";

const legacyAgents = [
  { engine: "codex", name: "Codex" },
  { engine: "claude", name: "Claude Code" },
] as const;

/** 共享紧凑主从布局；仅挂载选中的 Agent，保留保存屏障和原生准备边界。 */
export function AcpSettingsPanel({
  client,
  language,
  Field,
  Select,
  openExternalUrl,
  initialEngine = "codex",
}: Readonly<{
  client: Partial<AcpAuthClient & AcpCatalogClient> & AcpDefaultsClient;
  language: "zh-CN" | "en";
  initialEngine?: AgentEngine;
  openExternalUrl?: (url: string) => void | Promise<void>;
}> &
  Pick<AcpConfigOptionsProps, "Field" | "Select">) {
  const [selection, setEngine] = useState(initialEngine);
  const [adding, setAdding] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const [installing, setInstalling] = useState(false);
  const [updating, setUpdating] = useState<AgentEngine>();
  const [maintaining, setMaintaining] = useState(false);
  const managed =
    !!client.getAcpAgentCatalog && !!client.installAcpAgent && !!client.configureAcpAgent;
  const catalog = useQuery({
    queryKey: ["acp-agent-catalog"],
    enabled: managed,
    queryFn: ({ signal }) =>
      client.getAcpAgentCatalog?.({ signal }) ?? Promise.reject(new Error("ACP unavailable")),
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const agents: readonly { engine: AgentEngine; name: string; enabled?: boolean }[] = managed
    ? (catalog.data?.agents.filter((agent) => agent.installed) ?? [])
    : legacyAgents;
  // 只观察连接表单的缓存。打开设置时只检测选中的 Agent，避免同时启动多个进程。
  const connections = useQueries({
    queries: agents.map(({ engine }) => ({
      queryKey: ["acp-agent-profile", engine],
      queryFn: skipToken,
      select: hasAcpAgentConnection,
    })),
  });
  const engine = agents.some((agent) => agent.engine === selection) ? selection : agents[0]?.engine;
  const selected = catalog.data?.agents.find((agent) => agent.engine === engine && agent.installed);

  const navigate = useSettingsNavigation();
  const enabled = useSelectedEngines();
  const chinese = language === "zh-CN";
  const name = agents.find((agent) => agent.engine === engine)?.name ?? "";
  const cache = useQueryClient();
  const activation = useContext(EngineActivationContext);
  const snapshot = useSyncExternalStore(
    activation?.subscribe ?? noSubscribe,
    activation?.getSnapshot ?? noSnapshot,
    activation?.getSnapshot ?? noSnapshot,
  );
  useEffect(() => {
    if (managed && catalog.data)
      activation?.synchronize(
        catalog.data.agents
          .filter((agent) => agent.installed && agent.enabled)
          .map((agent) => agent.engine),
      );
  }, [activation, managed, catalog.data]);
  const configureEnabled = async (target: AgentEngine, checked: boolean) => {
    const agent = catalog.data?.agents.find((agent) => agent.engine === target);
    if (!agent?.command || !client.configureAcpAgent) throw new Error("ACP unavailable");
    setUpdating(target);
    try {
      const page = await client.configureAcpAgent({
        engine: target,
        name: agent.name,
        command: agent.command,
        args: agent.args ?? [],
        enabled: checked,
      });
      cache.setQueryData<AcpAgentCatalogPage>(["acp-agent-catalog"], page);
      activation?.synchronize(
        page.agents
          .filter((agent) => agent.enabled && agent.installed)
          .map((agent) => agent.engine),
      );
    } finally {
      setUpdating(undefined);
    }
  };
  const detail = engine ? (
    <div className="space-y-7">
      <AcpAuthSettings
        key={engine}
        client={client}
        engine={engine}
        language={language}
        openExternalUrl={openExternalUrl}
        connectedContent={
          <SettingsGroup title={chinese ? "会话默认配置" : "Session defaults"}>
            <AcpDefaultSettings
              client={client}
              engine={engine}
              Field={Field}
              Select={Select}
              labels={acpDefaultSettingsLabels[language]}
              language={language}
            />
          </SettingsGroup>
        }
      />
    </div>
  ) : null;
  return (
    <section aria-label="ACP" className="h-full min-h-0 min-w-0">
      <div className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden lg:grid-rows-1 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside
          aria-label="Agent"
          className="flex min-h-0 min-w-0 flex-col overflow-hidden border-b border-separator border-l border-l-separator-strong bg-window p-3 lg:border-b-0 lg:border-r lg:py-4"
        >
          <div className="mb-3 flex shrink-0 items-center justify-between px-2.5">
            <h2 className="text-label font-medium text-muted-foreground">Agent</h2>
            <span className="text-label tabular-nums text-subtle-foreground">{agents.length}</span>
          </div>
          <nav
            aria-label={chinese ? "选择 Agent" : "Choose agent"}
            className="flex min-h-0 gap-1 overflow-x-auto overscroll-contain lg:flex-1 lg:flex-col lg:overflow-y-auto"
          >
            {agents.map((agent, index) => {
              const connection = connections[index];
              const connectionRequired =
                managed && !agent.enabled && !(connection?.isSuccess && connection.data);
              const lastLegacy =
                !managed &&
                (snapshot?.engines ?? enabled)?.length === 1 &&
                (snapshot?.engines ?? enabled)?.includes(agent.engine);
              return (
                <div
                  key={agent.engine}
                  className={`group/agent min-w-48 shrink-0 rounded-control transition-colors lg:min-w-0 ${engine === agent.engine ? "bg-control-hover" : "hover:bg-control-hover/60"}`}
                >
                  <div className="flex items-center gap-1 pr-2">
                    <Button
                      type="button"
                      variant="ghost"
                      aria-current={engine === agent.engine ? "page" : undefined}
                      disabled={maintaining}
                      className={`h-10 min-w-0 flex-1 justify-start gap-2 px-2.5 bg-transparent hover:bg-transparent ${engine === agent.engine ? "text-foreground" : "text-muted-foreground"}`}
                      onClick={() => {
                        if (engine !== agent.engine)
                          navigate(() => {
                            setEngine(agent.engine);
                          });
                      }}
                    >
                      <span
                        aria-hidden="true"
                        className="flex size-6 shrink-0 items-center justify-center [&>svg]:size-5"
                      >
                        <AgentEngineIcon engine={agent.engine} />
                      </span>
                      <span className="min-w-0 flex-1 text-left text-body-small font-medium">
                        {agent.name}
                      </span>
                    </Button>
                    <Switch
                      aria-label={chinese ? `启用 ${agent.name}` : `Enable ${agent.name}`}
                      checked={
                        managed
                          ? (agent.enabled ?? false)
                          : ((snapshot?.engines ?? enabled)?.includes(agent.engine) ?? true)
                      }
                      disabled={
                        (!activation && !managed) ||
                        maintaining ||
                        updating !== undefined ||
                        snapshot?.states[agent.engine]?.phase === "preparing" ||
                        connectionRequired ||
                        !!lastLegacy
                      }
                      title={
                        connectionRequired
                          ? chinese
                            ? "请先登录账号或连接自定义 API"
                            : "Sign in or connect a custom API first"
                          : lastLegacy
                            ? chinese
                              ? "至少启用一个 Agent"
                              : "Keep at least one agent enabled"
                            : undefined
                      }
                      onCheckedChange={(checked) => {
                        navigate(() => {
                          if (managed) {
                            void configureEnabled(agent.engine, checked).catch(() => {
                              toast.error(chinese ? "更新失败" : "Could not update");
                            });
                            return;
                          }
                          if (!activation) return;
                          if (!checked) {
                            activation.disable(agent.engine);
                            return;
                          }
                          void activation
                            .enable(agent.engine, async (report) => {
                              report(chinese ? "正在检查智能体…" : "Checking agent…");
                              if (!client.getAcpAgent) throw new Error("ACP unavailable");
                              const profile = await client.getAcpAgent(agent.engine);
                              if (profile.engine !== agent.engine)
                                throw new Error("ACP engine mismatch");
                              cache.setQueryData(["acp-agent-profile", agent.engine], profile);
                            })
                            .catch(() => {
                              /* 准备失败由共享状态显示，开关保持关闭。 */
                            });
                        });
                      }}
                    />
                  </div>
                  {snapshot?.states[agent.engine]?.phase === "failed" &&
                  (snapshot.engines.includes(agent.engine) || engine !== agent.engine) ? (
                    <p role="alert" className="px-2.5 pb-2 text-label text-danger">
                      {chinese ? "更新失败，请重试" : "Could not update. Try again."}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </nav>
          {managed ? (
            // 添加入口独立于滚动列表，Agent 较多时也能在栏底直接操作。
            <div className="mt-2 shrink-0 border-t border-separator pt-2 lg:mt-3">
              <Button
                type="button"
                variant="ghost"
                contentAlign="start"
                className="w-full gap-2 px-2.5 font-medium"
                ref={addButton}
                disabled={maintaining}
                onClick={() => {
                  navigate(() => {
                    setAdding(true);
                  });
                }}
              >
                <Plus className="size-4" aria-hidden="true" />
                {chinese ? "添加 Agent" : "Add agent"}
              </Button>
            </div>
          ) : null}
        </aside>
        {engine ? (
          <div
            className="flex min-h-0 min-w-0 flex-col overflow-hidden"
            aria-label={chinese ? `${name} 配置` : `${name} settings`}
          >
            <header className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 border-b border-separator px-4 py-3 sm:gap-x-3 sm:px-6">
              <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className="flex size-8 shrink-0 items-center justify-center rounded-control border border-separator bg-control/50 [&>svg]:size-6"
                >
                  <AgentEngineIcon engine={engine} />
                </span>
                <h2 className="min-w-0 wrap-anywhere text-body font-semibold">{name}</h2>
              </div>
              <AgentVersion engine={engine} installedVersion={selected?.installedVersion} />
              {selected &&
              (client.removeAcpAgent || (selected.canUpdate && client.updateAcpAgent)) ? (
                <AcpAgentMaintenance
                  key={`maintenance:${engine}`}
                  agent={selected}
                  client={client}
                  zh={chinese}
                  disabled={updating !== undefined}
                  onPendingChange={setMaintaining}
                  navigate={navigate}
                  fallbackFocus={addButton}
                  onChanged={(page, removed) => {
                    void invalidateAcpPreviews(cache, engine);
                    cache.setQueryData<AcpAgentCatalogPage>(["acp-agent-catalog"], page);
                    if (removed) {
                      toast.success(chinese ? "已移除 Agent" : "Agent removed");
                      requestAnimationFrame(() => addButton.current?.focus());
                    }
                  }}
                />
              ) : null}
            </header>
            <div
              data-slot="settings-detail-scroll"
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6"
            >
              {managed ? (
                detail
              ) : (
                <AcpEngineSettingsGate
                  key={engine}
                  client={client}
                  engine={engine}
                  language={language}
                >
                  {detail}
                </AcpEngineSettingsGate>
              )}
            </div>
          </div>
        ) : null}
      </div>
      <Dialog
        open={adding}
        onOpenChange={(open) => {
          if (!installing)
            navigate(() => {
              setAdding(open);
            });
        }}
      >
        <DialogContent
          closeLabel={chinese ? "关闭" : "Close"}
          closeDisabled={installing}
          // 触发按钮位于左栏，显式交给通用浮层恢复焦点，兼容 Safari 点击按钮不聚焦的行为。
          finalFocus={addButton}
          className="flex max-h-[min(44rem,calc(100dvh-2rem))] flex-col overflow-hidden sm:max-w-xl"
        >
          <DialogHeader>
            <DialogTitle>{chinese ? "添加 Agent" : "Add agent"}</DialogTitle>
          </DialogHeader>
          {adding ? (
            <AcpAgentPicker
              client={client}
              language={language}
              onPendingChange={setInstalling}
              onAdded={(target) => {
                setEngine(target);
                setAdding(false);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** 版本跟随认证查询已有缓存，避免为展示元信息额外握手。 */
function AgentVersion({
  engine,
  installedVersion,
}: Readonly<{ engine: AgentEngine; installedVersion?: string | undefined }>) {
  const { data } = useQuery<AcpAgentProfile>({
    queryKey: ["acp-agent-profile", engine],
    queryFn: skipToken,
    enabled: false,
  });
  const version = installedVersion ?? data?.agentInfo?.version;
  return version ? (
    <span
      title={`v${version}`}
      className="col-start-2 row-start-1 max-w-20 truncate text-label tabular-nums text-subtle-foreground sm:max-w-32"
    >
      v{version}
    </span>
  ) : null;
}

const noSubscribe = () => () => undefined;
const noSnapshot = () => undefined;
