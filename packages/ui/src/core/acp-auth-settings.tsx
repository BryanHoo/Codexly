import { SettingsGroup } from "./settings-group.js";
import { useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { v4 as createUuid } from "uuid";
import type { AcpAgentProfile, AcpAuthCredentials, AgentEngine } from "@codexly/protocol";
import { Button } from "./button.js";
import { AcpConnectionForm, type AcpConnectionDraft } from "./acp-connection-form.js";
import type { AcpProviderSettingsClient } from "./acp-provider-settings.js";
import { LoadingSkeleton } from "./loading-skeleton.js";

export interface AcpAuthClient extends Partial<AcpProviderSettingsClient> {
  getAcpAgent: (
    engine: AgentEngine,
    options?: { signal?: AbortSignal },
  ) => Promise<AcpAgentProfile>;
  authenticateAcpAgent: (
    engine: AgentEngine,
    methodId: string,
    options?: { idempotencyKey?: string; signal?: AbortSignal; credentials?: AcpAuthCredentials },
  ) => Promise<unknown>;
}
const emptyProviders = [] as const;

/** 原生账号只表示账号身份；实际 API 连接以应用覆盖 / 本机配置的优先级独立展示。 */
export function AcpAuthSettings({
  client,
  engine,
  language,
}: Readonly<{ client: Partial<AcpAuthClient>; engine: AgentEngine; language: "zh-CN" | "en" }>) {
  const chinese = language === "zh-CN";
  const cache = useQueryClient();
  const attempt = useRef<{ input: string; key: string } | undefined>(undefined);
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
        await client.authenticateAcpAgent(engine, draft.methodId, {
          idempotencyKey: key,
          signal,
          ...(draft.methodId === "api-key" ? { credentials: { apiKey: draft.apiKey } } : {}),
        });
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
  const identity = profile.data.authStatus;
  const nativeLabel =
    identity?.kind === "account"
      ? [identity.label, identity.account?.email].filter(Boolean).join(" · ")
      : identity?.kind === "api_key"
        ? "API Key"
        : identity?.kind === "gateway"
          ? chinese
            ? "自定义 API"
            : "Custom API"
          : identity?.kind === "none"
            ? chinese
              ? "未登录"
              : "Not signed in"
            : chinese
              ? "未检测到账号状态"
              : "Account status not reported";
  return (
    <SettingsGroup title={chinese ? "连接配置" : "Connection settings"}>
      {!profile.data.connection?.baseUrl ? (
        <p className="break-words py-3 text-label text-muted-foreground">{nativeLabel}</p>
      ) : null}
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
    </SettingsGroup>
  );
}
