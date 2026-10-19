import type { AgentEngine } from "@codexly/protocol";
import type { EngineSetup } from "./engine-setup.js";

/** 只由用户确认选择后的动作调用；顺序准备降低下载、解压和进程启动的资源峰值。 */
export async function prepareSelectedEngines(
  engines: readonly AgentEngine[],
  prepare: (engine: AgentEngine) => Promise<void>,
): Promise<void> {
  if (!engines.length) throw new Error("Select an engine first");
  for (const engine of new Set(engines)) await prepare(engine);
}

/** 完成标记不随版本失效；没有标记时迁移已有配置，读取失败不能推断为首次使用。 */
export async function recoverEngineSetup(
  saved: EngineSetup | undefined,
  probe: () => Promise<readonly AgentEngine[]>,
): Promise<EngineSetup | undefined> {
  if (saved?.complete) return saved;
  const engines = [...new Set(await probe())];
  if (saved)
    return saved.engines.every((engine) => engines.includes(engine))
      ? { ...saved, complete: true }
      : saved;
  return engines.length ? { engines, complete: true } : undefined;
}
