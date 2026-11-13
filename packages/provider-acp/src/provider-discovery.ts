import { createAcpCapabilities } from "@codexly/protocol/acp-capabilities";
import type { AgentEngine } from "@codexly/protocol";
import type { AgentProvider } from "@codexly/core";
import type { SessionConfigOption } from "@agentclientprotocol/sdk/unstable";
import { acpModels } from "./session-options.js";

/** 这里只公布应用已经实现的操作；协议里存在的方法不能直接等同于产品能力。 */
export function acpCapabilities(engine: AgentEngine) {
  return Promise.resolve(createAcpCapabilities(engine));
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
