import { toast } from "./notifications.js";
import { useQuery } from "@tanstack/react-query";
import type { AcpCatalogClient } from "./acp-catalog-settings.js";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AcpDefaults, AgentEngine } from "@codexly/protocol";
import { ENGINE_SETUP_KEY, readEngineSetup } from "@codexly/frontend-core/engine-setup";
import { createAcpEngineSetupStorage } from "@codexly/frontend-core/acp-engine-setup";
import type { AcpAuthClient } from "./acp-auth-settings.js";
import { EngineSetupGate } from "./engine-setup-gate.js";
import { EngineSelectionProvider } from "./engine-selection-provider.js";
import { browserSetupStorage, type SetupStorage } from "./engine-selection.js";
import { Button } from "./button.js";

const AuthSettings = lazy(() =>
  import("./acp-auth-settings.js").then((module) => ({ default: module.AcpAuthSettings })),
);
export interface AcpEngineSetupClient extends AcpAuthClient {
  getAcpDefaults: (engine: AgentEngine) => Promise<AcpDefaults>;
}

function LegacyAcpEngineSetupGate({
  children,
  client,
  language,
  claudeSupported = true,
  storage = browserSetupStorage,
}: Readonly<{
  children: ReactNode;
  client: AcpEngineSetupClient;
  language: string;
  claudeSupported?: boolean;
  storage?: SetupStorage;
}>) {
  const cache = useQueryClient();
  const privateStorage = useMemo(() => createAcpEngineSetupStorage(storage), [storage]);
  const [saved] = useState(() => readEngineSetup(privateStorage.getItem(ENGINE_SETUP_KEY)));
  const engines = saved?.engines.filter((engine) => engine === "codex" || claudeSupported);
  // 已完成的用户直接进入工作区，不重新启动智能体、认证或设置会话。
  if (saved?.complete && engines?.length)
    return (
      <EngineSelectionProvider engines={engines} storage={privateStorage}>
        {children}
      </EngineSelectionProvider>
    );
  return (
    <EngineSetupGate
      language={language}
      storage={privateStorage}
      claudeSupported={claudeSupported}
      discover={() => Promise.resolve([])}
      prepare={async (engine) => {
        const profile = await client.getAcpAgent(engine);
        if (profile.engine !== engine) throw new Error("ACP engine mismatch");
        cache.setQueryData(["acp-agent-profile", engine], profile);
      }}
      check={async (engine) => {
        // 握手或认证回执不足以证明可用；用户确认后才创建、校验并关闭设置会话。
        const defaults = await client.getAcpDefaults(engine);
        cache.setQueryData(["acp-defaults", engine], defaults);
        return true;
      }}
      renderConfiguration={(engine, actions) => (
        <Suspense
          fallback={
            <p role="status">{language.startsWith("zh") ? "正在读取配置…" : "Loading settings…"}</p>
          }
        >
          <AuthSettings
            key={engine}
            client={client}
            engine={engine}
            language={language.startsWith("zh") ? "zh-CN" : "en"}
          />
          <Button className="mt-5 w-full" onClick={actions.onConnected}>
            {actions.continueLabel}
          </Button>
        </Suspense>
      )}
    >
      {children}
    </EngineSetupGate>
  );
}

/** 工作区先挂载；目录检测与适配器准备在后台请求中完成，只通过应用通知反馈。 */
function CatalogSetup({
  children,
  client,
  language,
  storage = browserSetupStorage,
}: Parameters<typeof LegacyAcpEngineSetupGate>[0] & { client: Partial<AcpCatalogClient> }) {
  const privateStorage = useMemo(() => createAcpEngineSetupStorage(storage), [storage]);
  const refreshing = useRef(false);
  const query = useQuery({
    queryKey: ["acp-agent-catalog"],
    queryFn: ({ signal }) =>
      client.getAcpAgentCatalog?.({ signal, refresh: refreshing.current }) ??
      Promise.reject(new Error("ACP catalog unavailable")),
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const engines = useMemo(
    () =>
      query.data?.agents
        .filter((agent) => agent.installed && agent.enabled)
        .map((agent) => agent.engine) ?? [],
    [query.data],
  );
  const notificationId = `acp-discovery-${useId()}`;
  const running = useRef(false);
  const zh = language.startsWith("zh");
  const notifyLoading = useCallback(() => {
    running.current = true;
    toast.add({
      id: notificationId,
      type: "loading",
      title: zh
        ? "正在后台检测和准备 Agent…"
        : "Discovering and preparing agents in the background…",
      description: zh
        ? "可以继续使用应用，准备完成后会自动启用。"
        : "You can keep using the app. Agents become available when ready.",
      timeout: 0,
    });
  }, [notificationId, zh]);
  useEffect(() => {
    if (query.isFetching) {
      if (!running.current) notifyLoading();
      return;
    }
    if (!running.current) return;
    running.current = false;
    if (query.isError) {
      toast.error(zh ? "Agent 后台检测失败" : "Agent discovery failed", {
        id: notificationId,
        duration: 0,
        description: zh
          ? "可以继续使用应用，稍后重试或在设置 → ACP 中配置。"
          : "Keep using the app. Retry or configure agents in Settings → ACP.",
        action: {
          label: zh ? "重试" : "Retry",
          onClick: () => {
            refreshing.current = true;
            notifyLoading();
            void query.refetch().finally(() => {
              refreshing.current = false;
            });
          },
        },
      });
      return;
    }
    const agents = query.data?.agents ?? [];
    const failed = agents.filter((agent) => agent.error);
    const available = agents.filter((agent) => agent.installed && agent.enabled);
    if (failed.length) {
      toast.warning(zh ? "部分 Agent 准备失败" : "Some agents could not be prepared", {
        id: notificationId,
        duration: 0,
        description:
          failed
            .slice(0, 3)
            .map((agent) => agent.name)
            .join(", ") +
          (zh ? "，可在设置 → ACP 中重试安装。" : ". Retry installation in Settings → ACP."),
      });
    } else if (available.length) {
      toast.success(zh ? "Agent 已就绪" : "Agents are ready", {
        id: notificationId,
        description: available
          .slice(0, 4)
          .map((agent) => agent.name)
          .join(", "),
      });
    } else {
      toast.info(zh ? "尚未发现可用 Agent" : "No agents available yet", {
        id: notificationId,
        description: zh ? "可在设置 → ACP 中添加 Agent。" : "Add agents in Settings → ACP.",
      });
    }
  }, [
    notificationId,
    query.isFetching,
    query.isError,
    query.data,
    query.refetch,
    zh,
    notifyLoading,
  ]);
  useEffect(
    () => () => {
      running.current = false;
      toast.dismiss(notificationId);
    },
    [notificationId],
  );
  return (
    <EngineSelectionProvider engines={engines} synchronize storage={privateStorage}>
      {children}
    </EngineSelectionProvider>
  );
}
export function AcpEngineSetupGate(
  props: Parameters<typeof LegacyAcpEngineSetupGate>[0] & { client: Partial<AcpCatalogClient> },
) {
  return props.client.getAcpAgentCatalog ? (
    <CatalogSetup {...props} />
  ) : (
    <LegacyAcpEngineSetupGate {...props} />
  );
}
