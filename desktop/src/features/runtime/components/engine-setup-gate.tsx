import { useEngineProfileInvalidation } from "@codexly/ui/core/engine-profile-invalidation";
import { listen } from "@tauri-apps/api/event";
import type { AgentEngine } from "@codexly/protocol";
import { useEffect, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SelectedEnginesContext } from "@codexly/ui/core/engine-selection";
import { invoke } from "../../../platform/tauri/native-invoke.js";
import { getCurrentLanguage } from "../../../i18n/i18n.js";

const configuredEnginesKey = ["configured-engines"] as const;
const noEngines: readonly AgentEngine[] = [];

/** 配置是启用状态的唯一来源；旧向导选择不再启动未配置引擎，也不阻塞首次进入设置。 */
export function EngineSetupGate({ children }: Readonly<{ children: ReactNode }>) {
  useEngineProfileInvalidation();
  const client = useQueryClient();
  const configured = useQuery({
    queryKey: configuredEnginesKey,
    queryFn: () => invoke<AgentEngine[]>("get_configured_engines"),
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
    select: (engines) => import.meta.env.VITE_MACOS_LEGACY === "true"
      ? engines.filter((engine) => engine !== "claude") : engines,
  });
  useEffect(() => {
    // API 保存、退出登录及原生登录完成后刷新一次；不轮询、不重挂载工作区。
    const refresh = () => { void client.invalidateQueries({ queryKey: configuredEnginesKey }); };
    window.addEventListener("codexly:engine-settings-changed", refresh);
    let disposed = false;
    let unlisten: (() => void) | undefined;
    // 原生跨窗口变更也走同一失效事件，使聊天配置与设置页同步刷新。
    void listen("engine-configuration-changed", () => {
      window.dispatchEvent(new Event("codexly:engine-settings-changed"));
    }).then((stop) => {
      if (disposed) stop(); else unlisten = stop;
    }).catch(() => { /* 桥接尚未就绪时仍可通过窗口聚焦和设置事件恢复。 */ });
    return () => {
      disposed = true;
      unlisten?.();
      window.removeEventListener("codexly:engine-settings-changed", refresh);
    };
  }, [client]);
  return <SelectedEnginesContext value={configured.data ?? noEngines}>
    {configured.isError ? <div role="alert">
      {getCurrentLanguage() === "zh-CN" ? "无法读取引擎配置，请检查设置。" : "Unable to read engine configuration. Check settings."}
      <button type="button" onClick={() => { void configured.refetch(); }}>{getCurrentLanguage() === "zh-CN" ? "重试" : "Retry"}</button>
    </div> : null}
    {children}
  </SelectedEnginesContext>;
}
