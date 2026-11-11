import { lazy, Suspense, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AgentCapabilities } from "@codexly/protocol";
import type { AcpEngineSetupClient } from "./acp-engine-setup-gate.js";
import { LoadingSkeleton } from "./loading-skeleton.js";
import { Button } from "./button.js";

const AcpSetup = lazy(() =>
  import("./acp-engine-setup-gate.js").then((module) => ({ default: module.AcpEngineSetupGate })),
);
interface SetupClient extends AcpEngineSetupClient {
  getCapabilities: (options: { signal: AbortSignal }) => Promise<AgentCapabilities>;
}

/** 运行时选择不触发厂商探测；沿用工作区能力缓存，旧实现只在旧分支加载。 */
export function AgentRuntimeSetupGate({
  client,
  children,
  legacy,
  language,
  claudeSupported = true,
}: Readonly<{
  client: SetupClient;
  children: ReactNode;
  legacy: ReactNode;
  language: string;
  claudeSupported?: boolean;
}>) {
  const capabilities = useQuery({
    queryKey: ["capabilities"],
    queryFn: ({ signal }) => client.getCapabilities({ signal }),
    retry: false,
  });
  const chinese = language.startsWith("zh");
  const loading = (
    <LoadingSkeleton variant="settings" label={chinese ? "正在读取运行时…" : "Loading runtime…"} />
  );
  if (capabilities.isError)
    return (
      <div role="alert">
        <p>{chinese ? "无法读取运行时，请重试。" : "Could not load the runtime. Try again."}</p>
        <Button onClick={() => void capabilities.refetch()}>{chinese ? "重试" : "Retry"}</Button>
      </div>
    );
  if (!capabilities.data) return loading;
  return (
    <Suspense fallback={loading}>
      {capabilities.data.runtime === "acp" ? (
        <AcpSetup client={client} language={language} claudeSupported={claudeSupported}>
          {children}
        </AcpSetup>
      ) : (
        legacy
      )}
    </Suspense>
  );
}
