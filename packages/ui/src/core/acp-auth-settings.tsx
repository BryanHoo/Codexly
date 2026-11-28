import { SettingsGroup } from "./settings-group.js";
import { useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  acpSettingsRefreshKey,
  acpSettingsSnapshotKey,
  invalidateAcpPreviews,
} from "./acp-preview-cache.js";
import { v4 as createUuid } from "uuid";
import {
  hasAcpAgentConnection,
  type AcpAgentProfile,
  type AcpAuthCredentials,
  type AcpDefaults,
  type AcpSettingsSnapshot,
  type AgentEngine,
} from "@codexly/protocol";
import { Button } from "./button.js";
import { AcpConnectionForm, type AcpConnectionDraft } from "./acp-connection-form.js";
import type { AcpProviderSettingsClient } from "./acp-provider-settings.js";
import { LoadingSkeleton } from "./loading-skeleton.js";
import { AcpAuthElicitation, type AcpAuthElicitationClient } from "./acp-auth-elicitation.js";

export interface AcpAuthClient extends Partial<AcpProviderSettingsClient> {
  getAcpSettingsSnapshot?: SnapshotRequest;
  refreshAcpSettingsSnapshot?: SnapshotRequest;
  getAcpAgent: (
    engine: AgentEngine,
    options?: { signal?: AbortSignal },
  ) => Promise<AcpAgentProfile>;
  authenticateAcpAgent: (
    engine: AgentEngine,
    methodId: string,
    options?: {
      idempotencyKey?: string;
      signal?: AbortSignal;
      credentials?: AcpAuthCredentials;
      attemptId?: string;
    },
  ) => Promise<unknown>;
  acpAuthElicitation: AcpAuthElicitationClient;
}
type SnapshotRequest = (
  engine: AgentEngine,
  options?: { signal?: AbortSignal },
) => Promise<AcpSettingsSnapshot | null>;

const emptyProviders = [] as const;

/** 原生账号只表示账号身份；实际 API 连接以应用覆盖 / 本机配置的优先级独立展示。 */
export function AcpAuthSettings({
  client,
  engine,
  language,
  openExternalUrl,
  connectedContent,
  useSnapshots = true,
}: Readonly<{
  client: Partial<AcpAuthClient>;
  engine: AgentEngine;
  language: "zh-CN" | "en";
  openExternalUrl?: ((url: string) => void | Promise<void>) | undefined;
  connectedContent?: (defaults?: AcpDefaults) => ReactNode;
  useSnapshots?: boolean;
}>) {
  const chinese = language === "zh-CN";
  const cache = useQueryClient();
  const attempt = useRef<{ input: string; key: string } | undefined>(undefined);
  const [activeAttempt, setActiveAttempt] = useState<string>();
  const supportsSnapshots =
    useSnapshots && !!client.getAcpSettingsSnapshot && !!client.refreshAcpSettingsSnapshot;
  const snapshotKey = acpSettingsSnapshotKey(engine);
  const refreshKey = acpSettingsRefreshKey(engine);
  const snapshot = useQuery({
    queryKey: snapshotKey,
    enabled: supportsSnapshots,
    queryFn: ({ signal }) => client.getAcpSettingsSnapshot?.(engine, { signal }) ?? null,
    staleTime: Infinity,
    retry: false,
  });
  // 先交付磁盘结果。独立查询跟踪实时检查的状态，失败时不覆盖已展示的数据。
  const live = useQuery({
    queryKey: refreshKey,
    enabled: supportsSnapshots && snapshot.fetchStatus === "idle" && !snapshot.isPending,
    queryFn: async ({ signal }) => {
      const refreshed = await client.refreshAcpSettingsSnapshot?.(engine, { signal });
      const value =
        refreshed ??
        (client.getAcpAgent
          ? { profile: await client.getAcpAgent(engine, { signal }) }
          : undefined);
      signal.throwIfAborted();
      if (!value || value.profile.engine !== engine) throw new Error("ACP settings unavailable");
      cache.setQueryData(snapshotKey, value);
      cache.setQueryData(["acp-agent-profile", engine], value.profile);
      return true;
    },
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const profile = useQuery({
    queryKey: ["acp-agent-profile", engine],
    enabled: !supportsSnapshots && !!client.getAcpAgent,
    queryFn: async ({ signal }) => {
      if (!client.getAcpAgent) throw new Error("ACP unavailable");
      const value = await client.getAcpAgent(engine, { signal });
      if (value.engine !== engine) throw new Error("ACP engine mismatch");
      return value;
    },
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const profileData = supportsSnapshots ? snapshot.data?.profile : profile.data;
  const profileFailed = supportsSnapshots ? live.isError : profile.isError;
  const providers = useQuery({
    queryKey: ["acp-providers", engine],
    enabled: profileData?.providerConfiguration === true && !!client.getAcpProviders,
    queryFn: ({ signal }) =>
      client.getAcpProviders?.(engine, { signal }) ??
      Promise.reject(new Error("ACP providers unavailable")),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const refresh = async () => {
    void invalidateAcpPreviews(cache, engine);
    let updated: AcpAgentProfile | undefined;
    if (supportsSnapshots) {
      const next = await live.refetch({ cancelRefetch: false });
      if (next.isError) throw new Error("Unable to refresh connection");
      updated = cache.getQueryData<AcpSettingsSnapshot>(snapshotKey)?.profile;
    } else {
      const next = await profile.refetch({ cancelRefetch: false });
      if (next.isError) throw new Error("Unable to refresh connection");
      updated = next.data;
    }
    if (updated?.providerConfiguration && client.getAcpProviders)
      await providers.refetch({ cancelRefetch: false });
  };
  const submit = async (draft: AcpConnectionDraft, signal: AbortSignal) => {
    const input = JSON.stringify(draft);
    const key = attempt.current?.input === input ? attempt.current.key : createUuid();
    attempt.current = { input, key };
    if (supportsSnapshots) await cache.cancelQueries({ queryKey: refreshKey, exact: true });
    signal.throwIfAborted();
    if (draft.mode === "custom") {
      if (!client.configureAcpProvider) throw new Error("ACP providers unavailable");
      const url = new URL(draft.baseUrl.trim());
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
        throw new Error("Invalid URL");
      const headers = draft.apiKey
        ? draft.apiType === "anthropic"
          ? { "x-api-key": draft.apiKey }
          : { Authorization: `Bearer ${draft.apiKey}` }
        : undefined;
      const page = await client.configureAcpProvider(
        engine,
        {
          providerId: draft.providerId,
          apiType: draft.apiType,
          baseUrl: draft.baseUrl.trim(),
          ...(headers ? { headers } : {}),
        },
        { idempotencyKey: key },
      );
      cache.setQueryData(["acp-providers", engine], page);
    } else {
      if (draft.methodId && client.authenticateAcpAgent) {
        if (draft.methodId === "api-key" && !draft.apiKey.trim())
          throw new Error("API key is required");
        const attemptId = client.acpAuthElicitation ? key : undefined;
        setActiveAttempt(attemptId);
        try {
          await client.authenticateAcpAgent(engine, draft.methodId, {
            idempotencyKey: key,
            signal,
            ...(attemptId === undefined ? {} : { attemptId }),
            ...(draft.methodId === "api-key" ? { credentials: { apiKey: draft.apiKey } } : {}),
          });
        } finally {
          setActiveAttempt(undefined);
        }
        signal.throwIfAborted();
      }
      // 仅在用户明确切换到本机配置并完成登录后移除应用覆盖，不改写 CLI 全局配置。
      if (
        profileData?.connection?.source === "application" &&
        profileData.connection.providerId &&
        client.disableAcpProvider
      ) {
        const page = await client.disableAcpProvider(engine, profileData.connection.providerId, {
          idempotencyKey: `${key}:native`,
        });
        cache.setQueryData(["acp-providers", engine], page);
      }
    }
    if (supportsSnapshots) {
      // 配置写入已切换身份，清除旧选项，再以新身份刷新。
      cache.setQueryData(snapshotKey, null);
      cache.removeQueries({ queryKey: ["acp-agent-profile", engine], exact: true });
      cache.removeQueries({ queryKey: ["acp-defaults", engine], exact: true });
    }
    await refresh();
    attempt.current = undefined;
    void cache.invalidateQueries({ queryKey: ["acp-defaults", engine], exact: true });
  };
  if (!profileData && (profileFailed || (!supportsSnapshots && !client.getAcpAgent)))
    return (
      <div role="alert" className="flex items-center justify-between text-label">
        <span>{chinese ? "连接配置读取失败" : "Could not read connection"}</span>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            void refresh().catch(() => undefined);
          }}
        >
          {chinese ? "重试" : "Retry"}
        </Button>
      </div>
    );
  if (
    !profileData ||
    (!supportsSnapshots && providers.isPending && providers.fetchStatus !== "idle")
  )
    return (
      <LoadingSkeleton
        variant={supportsSnapshots ? "settings-fields" : "settings"}
        label={chinese ? "正在读取连接…" : "Loading connection…"}
        className="p-0"
      />
    );
  const connected = hasAcpAgentConnection(profileData);
  return (
    <>
      <SettingsGroup
        title={chinese ? "连接配置" : "Connection settings"}
        headingAccessory={
          <ConnectionStatus profile={profileData} connected={connected} chinese={chinese} />
        }
      >
        {profileFailed ? (
          <p role="alert" className="py-2 text-label text-danger">
            {chinese
              ? "重新检测失败，正在显示上次读取的配置。"
              : "Check failed. Showing the last loaded settings."}
          </p>
        ) : null}
        {providers.isError ? (
          <p role="alert" className="py-2 text-label text-danger">
            {chinese
              ? "API 供应商读取失败，请重新检测。"
              : "Could not read API providers. Detect again to retry."}
          </p>
        ) : null}
        <AcpConnectionForm
          profile={profileData}
          providers={providers.data?.providers ?? emptyProviders}
          language={language}
          submit={submit}
          refresh={() => refresh().catch(() => undefined)}
        />
        {activeAttempt && client.acpAuthElicitation ? (
          <AcpAuthElicitation
            key={activeAttempt}
            attemptId={activeAttempt}
            engine={engine}
            request={client.acpAuthElicitation.bind(client)}
            language={language}
            openExternalUrl={openExternalUrl}
          />
        ) : null}
      </SettingsGroup>
      {connected ? connectedContent?.(snapshot.data?.defaults) : null}
    </>
  );
}

function ConnectionStatus({
  profile,
  connected,
  chinese,
}: Readonly<{ profile: AcpAgentProfile | undefined; connected: boolean; chinese: boolean }>) {
  const identity = profile?.authStatus;
  const copy = chinese
    ? {
        connected: "已连接",
        signedOut: "未登录",
        customApi: "自定义 API",
        unknown: "状态未知",
        failed: "检测失败",
      }
    : {
        connected: "Connected",
        signedOut: "Not signed in",
        customApi: "Custom API",
        unknown: "Status unknown",
        failed: "Check failed",
      };
  const label = connected
    ? copy.connected
    : !profile
      ? copy.failed
      : identity?.kind === "none"
        ? copy.signedOut
        : copy.unknown;
  // 标题以纯文字展示连接结论，已连接使用主题色；账号和 API 路由保留为补充提示。
  const details = [
    identity?.kind === "account" ? identity.label : undefined,
    identity?.kind === "account" ? identity.account?.email : undefined,
    profile?.connection || identity?.kind === "gateway" ? copy.customApi : undefined,
    identity?.kind === "api_key" ? "API Key" : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span
      role="status"
      aria-label={chinese ? "连接状态" : "Connection status"}
      title={details || undefined}
      className={`shrink-0 whitespace-nowrap text-meta font-medium ${
        connected ? "text-brand" : "text-muted-foreground"
      }`}
    >
      {label}
    </span>
  );
}
