import { canShowAcpFastMode } from "@codexly/frontend-core/acp-config-visibility";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AcpAgentProfile, AgentEngine } from "@codexly/protocol";

export interface AcpProfileClient {
  getAcpAgent?: (
    engine: AgentEngine,
    options?: { signal?: AbortSignal },
  ) => Promise<AcpAgentProfile>;
}
/** 只在 Agent 公布快速模式且存在身份端口时挂载查询，复用设置页缓存，不探测其他引擎。 */
export function AcpFastModeGate({
  engine,
  client,
  children,
}: Readonly<{
  engine?: AgentEngine | undefined;
  client?: AcpProfileClient | undefined;
  children: ReactNode;
}>) {
  if (engine !== "codex" || !client?.getAcpAgent) return null;
  return (
    <AcpProfileGate engine={engine} client={client} visible={canShowAcpFastMode}>
      {children}
    </AcpProfileGate>
  );
}

/** 额度和快速模式共享设置页的身份快照；自定义 API 优先于 CLI 中保留的账号登录。 */
export function AcpProfileGate({
  engine,
  client,
  children,
  visible,
}: {
  engine: AgentEngine;
  client: AcpProfileClient;
  visible: (profile: AcpAgentProfile) => boolean;
  children: ReactNode;
}) {
  const profile = useQuery({
    queryKey: ["acp-agent-profile", engine],
    enabled: !!client.getAcpAgent,
    queryFn: ({ signal }) =>
      client.getAcpAgent?.(engine, { signal }) ?? Promise.reject(new Error("ACP 身份端口不可用")),
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  return client.getAcpAgent &&
    !profile.isFetching &&
    !profile.isError &&
    profile.data?.engine === engine &&
    visible(profile.data)
    ? children
    : null;
}
