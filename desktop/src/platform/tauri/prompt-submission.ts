import { Value } from "@sinclair/typebox/value";
import type { AgentTask, StartAgentTurnResponse } from "@/protocol/index.js";
import { SubmitPromptResponseSchema, type SubmitPromptRequest } from "@/protocol/prompt-submission.js";
import { submitTask, type SubmissionCall } from "./task-submission.js";

export type SubmitPromptOptions = SubmitPromptRequest & Readonly<{ onTaskCreated?: (task: AgentTask) => void }>;

export function submitPrompt(call: SubmissionCall, options: SubmitPromptOptions) {
  const { onTaskCreated, ...request } = options;
  return submitTask<StartAgentTurnResponse>(call, "submit_prompt", request, (value) => {
    if (!Value.Check(SubmitPromptResponseSchema, value)) throw new Error("Invalid prompt submission response");
    return value;
  }, onTaskCreated);
}
