import { useContext, useSyncExternalStore, type ReactNode } from "react";
import type { AgentEngine } from "@codexly/protocol";
import type { PrepareEngine } from "@codexly/frontend-core/engine-activation";
import { EngineActivationContext, useSelectedEngines } from "./engine-selection.js";
import { Button } from "./button.js";
const noopSubscribe = () => () => undefined;
const emptySnapshot = () => undefined;

/** 不挂载未启用引擎的子面板，防止配置查询绕过用户确认而启动下载或进程。 */
export function EngineSettingsGate({
  engine,
  language,
  download,
  prepare,
  children,
}: Readonly<{
  engine: AgentEngine;
  language: string;
  download: boolean;
  prepare: PrepareEngine;
  children: ReactNode;
}>) {
  const activation = useContext(EngineActivationContext);
  const selected = useSelectedEngines();
  const snapshot = useSyncExternalStore(
    activation?.subscribe ?? noopSubscribe,
    activation?.getSnapshot ?? emptySnapshot,
    activation?.getSnapshot ?? emptySnapshot,
  );
  const enabled = (snapshot?.engines ?? selected)?.includes(engine) ?? true;
  const chinese = language.startsWith("zh");
  const name = engine === "codex" ? "Codex" : "Claude";
  if (enabled) return children;
  const state = snapshot?.states[engine];
  const busy = state?.phase === "preparing";
  const failed = state?.phase === "failed";
  return (
    <section className="space-y-5" aria-label={chinese ? `${name} 启用` : `Enable ${name}`}>
      <h1 className="text-xl font-semibold">{name}</h1>
      <p className="text-body-small text-muted-foreground">
        {chinese
          ? download
            ? `尚未启用 ${name}。启用后会下载并校验所需组件，完成后即可配置连接。`
            : `尚未启用 ${name}。启用后会检查服务端运行环境，准备完成后即可配置连接。`
          : download
            ? `${name} is not enabled. Download and verify its components before configuring a connection.`
            : `${name} is not enabled. Check the server runtime before configuring a connection.`}
      </p>
      {busy ? (
        <p role="status" className="text-body-small">
          {state.message || (chinese ? "正在准备…" : "Preparing…")}
        </p>
      ) : null}
      {failed ? (
        <p role="alert" className="text-body-small text-danger">
          {chinese
            ? "准备失败，请重试。已完成的下载会复用。"
            : "Preparation failed. Retry to reuse completed downloads."}
        </p>
      ) : null}
      <Button
        disabled={busy || !activation}
        onClick={() => {
          void activation?.enable(engine, prepare).catch(() => {
            /* 错误保留在共享状态，切换菜单后仍可重试。 */
          });
        }}
      >
        {busy
          ? chinese
            ? "正在准备…"
            : "Preparing…"
          : failed
            ? chinese
              ? "重试"
              : "Retry"
            : chinese
              ? `启用${download ? "并下载" : ""} ${name}`
              : `Enable${download ? " and download" : ""} ${name}`}
      </Button>
    </section>
  );
}
