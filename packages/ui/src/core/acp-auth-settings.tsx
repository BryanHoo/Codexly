import { SettingsGroup } from "./settings-group.js";
import { useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invalidateAcpPreviews } from "./acp-preview-cache.js";
import { v4 as createUuid } from "uuid";
import {
  hasAcpAgentConnection,
  type AcpAgentProfile,
  type AcpAuthCredentials,
  type AgentEngine,
} from "@codexly/protocol";
import { Button } from "./button.js";
import { AcpConnectionForm, type AcpConnectionDraft } from "./acp-connection-form.js";
import type { AcpProviderSettingsClient } from "./acp-provider-settings.js";
import { LoadingSkeleton } from "./loading-skeleton.js";
import { AcpAuthElicitation, type AcpAuthElicitationClient } from "./acp-auth-elicitation.js";

export interface AcpAuthClient extends Partial<AcpProviderSettingsClient> {
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
const emptyProviders = [] as const;

/** 原生账号只表示账号身份；实际 API 连接以应用覆盖 / 本机配置的优先级独立展示。 */
export function AcpAuthSettings({
  client,
  engine,
  language,
  openExternalUrl,
  connectedContent,
}: Readonly<{
  client: Partial<AcpAuthClient>;
  engine: AgentEngine;
  language: "zh-CN" | "en";
  openExternalUrl?: ((url: string) => void | Promise<void>) | undefined;
  connectedContent?: ReactNode;
}>) {
  const chinese = language === "zh-CN";
  const cache = useQueryClient();
  const attempt = useRef<{ input: string; key: string } | undefined>(undefined);
  const [activeAttempt, setActiveAttempt] = useState<string>();
  const profile = useQuery({
    queryKey: ["acp-agent-profile", engine],
    enabled: !!client.getAcpAgent,
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
  const providers = useQuery({
    queryKey: ["acp-providers", engine],
    enabled: profile.data?.providerConfiguration === true && !!client.getAcpProviders,
    queryFn: ({ signal }) =>
      client.getAcpProviders?.(engine, { signal }) ??
      Promise.reject(new Error("ACP providers unavailable")),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const refresh = async () => {
    await invalidateAcpPreviews(cache, engine);
    const next = await profile.refetch({ cancelRefetch: false });
    if (next.isError) throw new Error("Unable to refresh connection");
    if (next.data?.providerConfiguration && client.getAcpProviders)
      await providers.refetch({ cancelRefetch: false });
  };
  const submit = async (draft: AcpConnectionDraft, signal: AbortSignal) => {
    const input = JSON.stringify(draft);
    const key = attempt.current?.input === input ? attempt.current.key : createUuid();
    attempt.current = { input, key };
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
        profile.data?.connection?.source === "application" &&
        profile.data.connection.providerId &&
        client.disableAcpProvider
      ) {
        const page = await client.disableAcpProvider(engine, profile.data.connection.providerId, {
          idempotencyKey: `${key}:native`,
        });
        cache.setQueryData(["acp-providers", engine], page);
      }
    }
    await refresh();
    attempt.current = undefined;
    void cache.invalidateQueries({ queryKey: ["acp-defaults", engine], exact: true });
  };
  if (!profile.data && (profile.isError || !client.getAcpAgent))
    return (
      <div role="alert" className="flex items-center justify-between text-label">
        <span>{chinese ? "连接配置读取失败" : "Could not read connection"}</span>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            void profile.refetch();
          }}
        >
          {chinese ? "重试" : "Retry"}
        </Button>
      </div>
    );
  if (!profile.data || (providers.isPending && providers.fetchStatus !== "idle"))
    return (
      <LoadingSkeleton
        variant="settings"
        label={chinese ? "正在读取连接…" : "Loading connection…"}
        className="p-0"
      />
    );
  // 默认配置会创建临时会话，只有检测到原生认证或生效的 API 配置时才挂载。
  const connected = profile.isSuccess && hasAcpAgentConnection(profile.data);
  return (
    <>
      <SettingsGroup
        title={chinese ? "连接配置" : "Connection settings"}
        headingAccessory={
          <ConnectionStatus
            profile={profile.isSuccess ? profile.data : undefined}
            connected={connected}
            chinese={chinese}
          />
        }
      >
        {providers.isError ? (
          <p role="alert" className="py-2 text-label text-danger">
            {chinese
              ? "API 供应商读取失败，请重新检测。"
              : "Could not read API providers. Detect again to retry."}
          </p>
        ) : null}
        <AcpConnectionForm
          profile={profile.data}
          providers={providers.data?.providers ?? emptyProviders}
          language={language}
          submit={submit}
          refresh={refresh}
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
      {connected ? connectedContent : null}
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
  // 标题只展示连接结论，账号和生效的 API 路由作为补充提示。
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
      className={`inline-flex h-5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 text-meta font-medium ${
        connected
          ? "border-task-completed/20 bg-task-completed/10 text-task-completed"
          : "border-separator bg-control text-muted-foreground"
      }`}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}
