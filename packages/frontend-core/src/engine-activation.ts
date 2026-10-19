import type { AgentEngine } from "@codexly/protocol";
export type ActivationState = Readonly<{ phase: "idle" | "preparing" | "failed"; message: string }>;
export type EngineActivationSnapshot = Readonly<{
  engines: readonly AgentEngine[];
  states: Readonly<Record<AgentEngine, ActivationState>>;
}>;
export type PrepareEngine = (report: (message: string) => void) => Promise<void>;

/** 两端共用启用事务：准备成功并保存选择后才开放配置，切换设置菜单不丢失安装进度。 */
export function createEngineActivation(
  initial: readonly AgentEngine[],
  persist: (engines: readonly AgentEngine[]) => void,
) {
  let snapshot: EngineActivationSnapshot = {
    engines: initial,
    states: { codex: { phase: "idle", message: "" }, claude: { phase: "idle", message: "" } },
  };
  const listeners = new Set<() => void>();
  const pending = new Map<AgentEngine, Promise<void>>();
  const update = (engine: AgentEngine, state: ActivationState, engines = snapshot.engines) => {
    snapshot = { engines, states: { ...snapshot.states, [engine]: state } };
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    enable(engine: AgentEngine, prepare: PrepareEngine): Promise<void> {
      if (snapshot.engines.includes(engine)) return Promise.resolve();
      const existing = pending.get(engine);
      if (existing) return existing;
      // 保持旧版桌面 WebView 兼容，不依赖 Promise.withResolvers。
      let resolve!: () => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<void>((success, failure) => {
        resolve = success;
        reject = failure;
      });
      pending.set(engine, promise);
      update(engine, { phase: "preparing", message: "" });
      void (async () => {
        try {
          await prepare((message) => {
            update(engine, { phase: "preparing", message });
          });
          // 读取最新选择，防止两个引擎并发启用时覆盖另一方已完成的结果。
          const engines = [...new Set([...snapshot.engines, engine])];
          persist(engines);
          update(engine, { phase: "idle", message: "" }, engines);
          resolve();
        } catch (error) {
          update(engine, { phase: "failed", message: "" });
          reject(error);
        } finally {
          pending.delete(engine);
        }
      })();
      return promise;
    },
  };
}
export type EngineActivation = ReturnType<typeof createEngineActivation>;
