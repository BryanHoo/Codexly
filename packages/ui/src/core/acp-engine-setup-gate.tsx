import { toast } from "./notifications.js";
import { useQuery } from "@tanstack/react-query";
import type { AcpCatalogClient } from "./acp-catalog-settings.js";
import { acpStage, useAcpCatalogProgress } from "./acp-catalog-progress.js";
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
import {
  TEMPORARY_TASK_SCOPE_ID,
  type AcpConfigPreview,
  type AcpDefaults,
  type AgentEngine,
} from "@codexly/protocol";
import { AcpStartupCacheContext, warmAcpPreviews } from "./acp-preview-cache.js";
import type { AcpDraftClient } from "./use-acp-draft.js";
import { ENGINE_SETUP_KEY, readEngineSetup } from "@codexly/frontend-core/engine-setup";
import { createAcpEngineSetupStorage } from "@codexly/frontend-core/acp-engine-setup";
import type { AcpAuthClient } from "./acp-auth-settings.js";
import { EngineSetupGate } from "./engine-setup-gate.js";
import { EngineSelectionProvider } from "./engine-selection-provider.js";
import { browserSetupStorage, useSelectedEngines, type SetupStorage } from "./engine-selection.js";
import { Button } from "./button.js";

const AuthSettings = lazy(() =>
  import("./acp-auth-settings.js").then((module) => ({ default: module.AcpAuthSettings })),
);
export interface AcpEngineSetupClient extends AcpAuthClient {
  getAcpDefaults: (engine: AgentEngine) => Promise<AcpDefaults>;
  previewAcpConfig?: AcpDraftClient["previewAcpConfig"];
  getAcpConfigCache?: (
    engine: AgentEngine,
    options: { signal: AbortSignal },
  ) => Promise<AcpConfigPreview | null>;
  refreshAcpConfigCache?: (
    engine: AgentEngine,
    options: { signal: AbortSignal },
  ) => Promise<AcpConfigPreview | null>;
}

function AcpStartupPreview({
  client,
  children,
}: Readonly<{ client: AcpEngineSetupClient; children: ReactNode }>) {
  const cache = useQueryClient();
  const engines = useSelectedEngines();
  useEffect(() => {
    if (!engines?.length) return;
    if (client.getAcpConfigCache && client.refreshAcpConfigCache) {
      const read = client.getAcpConfigCache.bind(client);
      const refresh = client.refreshAcpConfigCache.bind(client);
      void warmAcpPreviews(
        cache,
        engines,
        (engine, signal) => refresh(engine, { signal }),
        undefined,
        (engine, signal) => read(engine, { signal }),
      );
      return;
    }
    const preview = client.previewAcpConfig;
    if (!preview) return;
    // 使用普通聊天的宿主作用域预取，项目切换和分屏共用此应用级菜单快照。
    void warmAcpPreviews(cache, engines, (engine, signal) =>
      preview.call(
        client,
        TEMPORARY_TASK_SCOPE_ID,
        engine,
        { values: {}, includeCommands: true },
        { signal },
      ),
    );
  }, [cache, client, engines]);
  return (
    <AcpStartupCacheContext value={client.previewAcpConfig !== undefined}>
      {children}
    </AcpStartupCacheContext>
  );
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
        <AcpStartupPreview client={client}>{children}</AcpStartupPreview>
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
      <AcpStartupPreview client={client}>{children}</AcpStartupPreview>
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
  // 完成记录跨页面刷新保留；日常目录读取不再重复播报初始化进度和成功。
  const initialized = useRef<boolean | undefined>(undefined);
  initialized.current ??=
    readEngineSetup(privateStorage.getItem(ENGINE_SETUP_KEY))?.complete === true;
  const refreshing = useRef(false);
  const savedCatalog = useQuery({
    queryKey: ["acp-agent-catalog-at-startup"],
    queryFn: ({ signal }) =>
      client.getAcpAgentCatalog?.({ signal, cached: true }) ??
      Promise.reject(new Error("ACP catalog unavailable")),
    enabled: client.getAcpConfigCache !== undefined,
    retry: false,
    staleTime: Infinity,
  });
  const query = useQuery({
    queryKey: ["acp-agent-catalog"],
    queryFn: ({ signal }) =>
      client.getAcpAgentCatalog?.({ signal, refresh: refreshing.current }) ??
      Promise.reject(new Error("ACP catalog unavailable")),
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const catalog = query.data ?? savedCatalog.data;
  const engines = useMemo(
    () =>
      catalog?.agents
        .filter((agent) => agent.installed && agent.enabled)
        .map((agent) => agent.engine) ?? [],
    [catalog],
  );
  const progress = useAcpCatalogProgress(client, query.isFetching);
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
        ? "准备完成后，可在设置 → ACP 中连接并启用。"
        : "When ready, connect and enable agents in Settings → ACP.",
      timeout: 0,
    });
  }, [notificationId, zh]);
  useEffect(() => {
    if (query.isFetching) {
      if (!running.current) {
        if (!initialized.current) notifyLoading();
        running.current = true;
      }
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
    const installed = agents.filter((agent) => agent.installed);
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
    } else if (installed.length) {
      if (initialized.current) {
        toast.dismiss(notificationId);
        return;
      }
      initialized.current = true;
      privateStorage.setItem(
        ENGINE_SETUP_KEY,
        JSON.stringify({ engines: installed.map((agent) => agent.engine), complete: true }),
      );
      toast.success(zh ? "Agent 已就绪" : "Agents are ready", {
        id: notificationId,
        description: installed
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
    privateStorage,
  ]);
  const automatic = progress?.operations.find((operation) => operation.action === "automatic");
  const checked = progress?.discovery;
  const stage = automatic ? acpStage(automatic.progress, zh) : undefined;
  const description = [
    checked
      ? zh
        ? `已检测 ${String(checked.checked)}/${String(checked.total)}`
        : `Checked ${String(checked.checked)}/${String(checked.total)}`
      : undefined,
    automatic && stage
      ? `${automatic.name}：${stage.label}${stage.detail ? ` ${stage.detail}` : ""}`
      : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  useEffect(() => {
    if (query.isFetching && description) toast.update(notificationId, { description });
  }, [description, notificationId, query.isFetching]);
  useEffect(
    () => () => {
      running.current = false;
      toast.dismiss(notificationId);
    },
    [notificationId],
  );
  return (
    <EngineSelectionProvider engines={engines} synchronize storage={privateStorage}>
      <AcpStartupPreview client={client}>{children}</AcpStartupPreview>
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
