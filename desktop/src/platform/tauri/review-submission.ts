import { Value } from "@sinclair/typebox/value";
import type { AgentTask, ReviewAgentTaskResponse } from "@/protocol/index.js";
import { SubmitReviewResponseSchema, type SubmitReviewRequest } from "@/protocol/review-submission.js";
import { submitTask, type SubmissionCall } from "./task-submission.js";

export type SubmitReviewOptions = SubmitReviewRequest & Readonly<{ onTaskCreated?: (task: AgentTask) => void }>;

export function submitReview(call: SubmissionCall, options: SubmitReviewOptions) {
  const { onTaskCreated, ...request } = options;
  return submitTask<ReviewAgentTaskResponse>(call, "submit_review", request, (value) => {
    if (!Value.Check(SubmitReviewResponseSchema, value)) throw new Error("Invalid review submission response");
    return value;
  }, onTaskCreated);
}
