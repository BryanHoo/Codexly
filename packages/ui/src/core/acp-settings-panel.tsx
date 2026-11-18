import { Plus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./dialog.js";
import { toast } from "./notifications.js";
import { AcpAgentPicker, type AcpCatalogClient } from "./acp-catalog-settings.js";
import { SettingsGroup } from "./settings-group.js";
import { useState, useRef, useContext, useEffect, useSyncExternalStore } from "react";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AcpAgentProfile, AgentEngine, AcpAgentCatalogPage } from "@codexly/protocol";
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
  initialEngine = "codex",
}: Readonly<{
  client: Partial<AcpAuthClient & AcpCatalogClient> & AcpDefaultsClient;
  language: "zh-CN" | "en";
  initialEngine?: AgentEngine;
}> &
  Pick<AcpConfigOptionsProps, "Field" | "Select">) {
  const [selection, setEngine] = useState(initialEngine);
  const [adding, setAdding] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const [installing, setInstalling] = useState(false);
  const [updating, setUpdating] = useState<AgentEngine>();
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
  const agents: readonly { engine: AgentEngine; name: string }[] = managed
    ? (catalog.data?.agents.filter((agent) => agent.installed) ?? [])
    : legacyAgents;
  const engine = agents.some((agent) => agent.engine === selection) ? selection : agents[0]?.engine;

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
      await cache.cancelQueries({ queryKey: ["acp-agent-catalog"] });
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
  return (
    <section aria-label="ACP" className="h-full min-h-0 min-w-0">
      <div className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden lg:grid-rows-1 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside
          aria-label="Agent"
          className="flex min-h-0 min-w-0 flex-col overflow-hidden border-b border-separator border-l border-l-separator-strong bg-window p-3 lg:border-b-0 lg:border-r lg:py-4"
        >
          <div className="mb-3 flex items-center justify-between px-2">
            <h2 className="text-label font-medium text-muted-foreground">Agent</h2>
            <div className="flex items-center gap-2">
              <span className="text-label tabular-nums text-subtle-foreground">
                {agents.length}
              </span>
              {managed ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-compact"
                  ref={addButton}
                  aria-label={chinese ? "添加 Agent" : "Add agent"}
                  onClick={() => {
                    navigate(() => {
                      setAdding(true);
                    });
                  }}
                >
                  <Plus className="size-4" />
                </Button>
              ) : null}
            </div>
          </div>
          <nav
            aria-label={chinese ? "选择 Agent" : "Choose agent"}
            className="flex min-h-0 gap-1 overflow-x-auto overscroll-contain lg:flex-1 lg:flex-col lg:overflow-y-auto"
          >
            {agents.map((agent) => (
              <div
                key={agent.engine}
                className={`group/agent min-w-48 shrink-0 rounded-control transition-colors lg:min-w-0 ${engine === agent.engine ? "bg-control-hover" : "hover:bg-control-hover/60"}`}
              >
                <div className="flex items-center gap-1 pr-2">
                  <Button
                    type="button"
                    variant="ghost"
                    aria-current={engine === agent.engine ? "page" : undefined}
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
                        ? (catalog.data?.agents.find((item) => item.engine === agent.engine)
                            ?.enabled ?? false)
                        : ((snapshot?.engines ?? enabled)?.includes(agent.engine) ?? true)
                    }
                    disabled={
                      (!activation && !managed) ||
                      updating === agent.engine ||
                      snapshot?.states[agent.engine]?.phase === "preparing" ||
                      ((snapshot?.engines ?? enabled)?.length === 1 &&
                        (snapshot?.engines ?? enabled)?.includes(agent.engine))
                    }
                    title={
                      (snapshot?.engines ?? enabled)?.length === 1 &&
                      (snapshot?.engines ?? enabled)?.includes(agent.engine)
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
            ))}
          </nav>
        </aside>
        {engine ? (
          <div
            className="flex min-h-0 min-w-0 flex-col overflow-hidden"
            aria-label={chinese ? `${name} 配置` : `${name} settings`}
          >
            <header className="flex shrink-0 items-center gap-3 border-b border-separator px-5 py-4 sm:px-6">
              <span
                aria-hidden="true"
                className="flex size-8 shrink-0 items-center justify-center rounded-control border border-separator bg-control/50 [&>svg]:size-6"
              >
                <AgentEngineIcon engine={engine} />
              </span>
              <h2 className="text-body font-semibold tracking-tight">{name}</h2>
              <AgentVersion engine={engine} />
            </header>
            <div
              data-slot="settings-detail-scroll"
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6"
            >
              <AcpEngineSettingsGate
                key={engine}
                client={client}
                engine={engine}
                language={language}
                prepareAgent={managed ? () => configureEnabled(engine, true) : undefined}
              >
                <div className="space-y-7">
                  <AcpAuthSettings
                    key={engine}
                    client={client}
                    engine={engine}
                    language={language}
                  />
                  <SettingsGroup title={chinese ? "会话默认配置" : "Session defaults"}>
                    <AcpDefaultSettings
                      key={engine}
                      client={client}
                      engine={engine}
                      Field={Field}
                      Select={Select}
                      labels={acpDefaultSettingsLabels[language]}
                      language={language}
                    />
                  </SettingsGroup>
                </div>
              </AcpEngineSettingsGate>
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
function AgentVersion({ engine }: Readonly<{ engine: AgentEngine }>) {
  const { data } = useQuery<AcpAgentProfile>({
    queryKey: ["acp-agent-profile", engine],
    queryFn: skipToken,
    enabled: false,
  });
  return data?.agentInfo?.version ? (
    <span className="ml-auto text-label tabular-nums text-subtle-foreground">
      v{data.agentInfo.version}
    </span>
  ) : null;
}

const noSubscribe = () => () => undefined;
const noSnapshot = () => undefined;
