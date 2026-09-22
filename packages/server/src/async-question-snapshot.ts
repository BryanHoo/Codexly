import { restoreAsyncQuestionAnswers, type AgentProviderTaskSnapshot } from "@codexly/core";
import type { ServerRouteContext } from "./routes/context.js";

export async function restorePersistedAsyncQuestionAnswers(
  context: ServerRouteContext,
  projectId: string,
  taskId: string,
  snapshot: AgentProviderTaskSnapshot,
): Promise<AgentProviderTaskSnapshot> {
  const repository = context.asyncQuestionRepository;
  if (repository === undefined) return snapshot;
  const records = await repository.listAsyncQuestions(projectId, taskId);
  return restoreAsyncQuestionAnswers(snapshot, records);
}
