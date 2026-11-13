import type { AgentEngine } from "./agent-engine.js";
import type { AgentCapabilities } from "./agent-runtime.js";

/** 两端只公布已经实现的 ACP 操作；能力查询不启动 agent，不读取账号或原生设置。 */
export function createAcpCapabilities(engine: AgentEngine): AgentCapabilities {
  return {
    runtime: "acp",
    provider: engine,
    feedback: { upload: false },
    goals: { clear: false, read: false, update: false },
    skills: { list: false, use: false },
    tasks: { fork: false, list: true, read: true, start: true },
    turns: { compact: false, interrupt: true, review: false, start: true, steer: false },
  };
}
