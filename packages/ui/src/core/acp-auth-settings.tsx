import { useLayoutEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { v4 as createUuid } from "uuid";
import type { AcpAgentProfile, AgentEngine } from "@codexly/protocol";
import { Button } from "./button.js";
import { AcpProviderSettings, type AcpProviderSettingsClient } from "./acp-provider-settings.js";
import { LoadingSkeleton } from "./loading-skeleton.js";

export interface AcpAuthClient extends Partial<AcpProviderSettingsClient> {
  getAcpAgent: (
    engine: AgentEngine,
    options?: { signal?: AbortSignal },
  ) => Promise<AcpAgentProfile>;
  authenticateAcpAgent: (
    engine: AgentEngine,
    methodId: string,
    options?: { idempotencyKey?: string; signal?: AbortSignal },
  ) => Promise<unknown>;
}

const labels = {
  "zh-CN": {
    loading: "正在读取认证方式…",
    unavailable: "无法读取智能体认证方式。",
    retry: "重试",
    empty: "智能体未公布可用的认证方式。",
    terminal: "当前宿主不支持交互式终端认证。",
    pending: "等待智能体完成认证…",
    success: "认证请求已完成。",
    error: "认证失败，请重试。",
  },
  en: {
    loading: "Loading sign-in methods…",
    unavailable: "Could not load sign-in methods.",
    retry: "Retry",
    empty: "The agent did not advertise any sign-in methods.",
    terminal: "This host does not support interactive terminal sign-in.",
    pending: "Waiting for the agent to finish signing in…",
    success: "Authentication request completed.",
    error: "Authentication failed. Try again.",
  },
};

interface Attempt {
  id: string;
  key: string;
}

export function AcpAuthSettings({
  client,
  engine,
  language,
}: Readonly<{ client: Partial<AcpAuthClient>; engine: AgentEngine; language: "zh-CN" | "en" }>) {
  const copy = labels[language];
  const cache = useQueryClient();
  const inspect = client.getAcpAgent;
  const authenticate = client.authenticateAcpAgent;
  const scope = useMemo(
    () => ({
      controller: undefined as AbortController | undefined,
      attempt: undefined as Attempt | undefined,
    }),
    [client, engine],
  );
  const [result, setResult] = useState<{
    scope: object;
    status: "pending" | "success" | "error";
  }>();
  const status = result?.scope === scope ? result.status : undefined;
  const profile = useQuery({
    queryKey: ["acp-agent-profile", engine],
    enabled: inspect !== undefined && authenticate !== undefined,
    queryFn: async ({ signal }) => {
      if (!inspect) throw new Error(copy.unavailable);
      const value = await inspect.call(client, engine, { signal });
      if (value.engine !== engine) throw new Error(copy.unavailable);
      return value;
    },
    retry: false,
    refetchOnWindowFocus: false,
  });
  useLayoutEffect(() => () => scope.controller?.abort(), [scope]);
  const run = async (method: AcpAgentProfile["authMethods"][number]) => {
    // 只有用户点击的已公布协议方法可以发起认证；同步锁挡住重复点击。
    if (!authenticate || method.type === "terminal" || scope.controller) return;
    const controller = new AbortController();
    const attempt =
      scope.attempt?.id === method.id ? scope.attempt : { id: method.id, key: createUuid() };
    scope.controller = controller;
    scope.attempt = attempt;
    setResult({ scope, status: "pending" });
    try {
      await authenticate.call(client, engine, attempt.id, {
        idempotencyKey: attempt.key,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      scope.attempt = undefined;
      setResult({ scope, status: "success" });
      // 登录由智能体处理；只刷新同引擎默认值，不能写入旧登录或连接记录。
      void cache.invalidateQueries({ queryKey: ["acp-defaults", engine], exact: true });
    } catch {
      if (!controller.signal.aborted) setResult({ scope, status: "error" });
    } finally {
      scope.controller = undefined;
    }
  };

  if (!inspect || !authenticate) return <p role="alert">{copy.unavailable}</p>;
  if (profile.isError)
    return (
      <div role="alert">
        <p>{copy.unavailable}</p>
        <Button type="button" variant="ghost" onClick={() => void profile.refetch()}>
          {copy.retry}
        </Button>
      </div>
    );
  if (!profile.data)
    return <LoadingSkeleton variant="settings" label={copy.loading} className="p-0" />;
  return (
    <div className="space-y-4">
      {profile.data.authMethods.length === 0 ? <p role="status">{copy.empty}</p> : null}
      {profile.data.authMethods.map((method) => (
        <div key={method.id} className="space-y-1">
          <Button
            type="button"
            variant="outline"
            disabled={status === "pending" || method.type === "terminal"}
            onClick={() => void run(method)}
          >
            {method.name}
          </Button>
          {method.description ? (
            <p className="text-label text-muted-foreground">{method.description}</p>
          ) : null}
          {method.type === "terminal" ? (
            <p className="text-label text-muted-foreground">{copy.terminal}</p>
          ) : null}
        </div>
      ))}
      {status ? <p role={status === "error" ? "alert" : "status"}>{copy[status]}</p> : null}
      {profile.data.providerConfiguration ? (
        <AcpProviderSettings key={engine} client={client} engine={engine} language={language} />
      ) : null}
    </div>
  );
}
