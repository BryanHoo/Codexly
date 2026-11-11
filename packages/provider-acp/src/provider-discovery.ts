import type { AgentEngine } from "@codexly/protocol";
import type { AgentProvider } from "@codexly/core";
import type { SessionConfigOption } from "@agentclientprotocol/sdk/unstable";
import { acpModels } from "./session-options.js";

/** 这里只公布应用已经实现的操作；协议里存在的方法不能直接等同于产品能力。 */
export function acpCapabilities(engine: AgentEngine) {
  return Promise.resolve({
    runtime: "acp" as const,
    provider: engine,
    feedback: { upload: false },
    goals: { clear: false, read: false, update: false },
    skills: { list: false, use: false },
    tasks: { fork: false, list: true, read: true, start: true },
    turns: { compact: false, interrupt: true, review: false, start: true, steer: false },
  });
}
export async function discoverAcpModels(
  provider: Pick<AgentProvider, "startTask"> & {
    readSessionConfiguration(id: string): Promise<SessionConfigOption[]>;
    unsubscribeTask(id: string): Promise<string>;
  },
) {
  const task = await provider.startTask({ ephemeral: true });
  try {
    return acpModels(await provider.readSessionConfiguration(task.id));
  } finally {
    await provider.unsubscribeTask(task.id);
  }
}
