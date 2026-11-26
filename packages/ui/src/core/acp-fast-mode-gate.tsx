import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AcpAgentProfile, AgentEngine } from "@codexly/protocol";
import { canShowAcpFastMode } from "@codexly/frontend-core/acp-config-visibility";

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
  return <VerifiedFastMode client={client}>{children}</VerifiedFastMode>;
}
function VerifiedFastMode({ client, children }: { client: AcpProfileClient; children: ReactNode }) {
  const profile = useQuery({
    queryKey: ["acp-agent-profile", "codex"],
    queryFn: ({ signal }) =>
      client.getAcpAgent?.("codex", { signal }) ?? Promise.reject(new Error("ACP 身份端口不可用")),
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  // 未确认身份或读取失败时保持隐藏；绝不靠账号标签或地址推测登录类型。
  return !profile.isFetching && !profile.isError && canShowAcpFastMode(profile.data)
    ? children
    : null;
}
