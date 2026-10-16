import {
  StopAgentSessionResponseSchema,
  InterruptAgentTurnResponseSchema,
  type StopAgentSessionResponse,
  type InterruptAgentTurnResponse,
} from "@codexly/protocol";
import { taskPath, type MutationOptions } from "./http-client-transport.js";
import { GlobalSearchHttpClient } from "./http-client-global-search.js";

export class SessionHttpClient extends GlobalSearchHttpClient {
  public async stopSession(
    projectId: string,
    taskId: string,
    backgroundTaskId?: string,
    options: MutationOptions = {},
  ): Promise<StopAgentSessionResponse> {
    return this.mutation(
      `${taskPath(projectId, taskId)}/session/stop`,
      { taskId, ...(backgroundTaskId ? { backgroundTaskId } : {}) },
      StopAgentSessionResponseSchema,
      options,
    );
  }

  public async interruptTurn(
    projectId: string,
    taskId: string,
    turnId: string,
    options: MutationOptions = {},
  ): Promise<InterruptAgentTurnResponse> {
    return this.mutation(
      `${taskPath(projectId, taskId)}/turns/${encodeURIComponent(turnId)}/interrupt`,
      { taskId },
      InterruptAgentTurnResponseSchema,
      options,
    );
  }
}
