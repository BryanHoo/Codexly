import type { AgentQueueRecord } from "@codexly/core";
import { AgentPromptInputSchema, AgentTurnSchema } from "@codexly/protocol";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export type QueueWorkerRecord = Omit<AgentQueueRecord, "input" | "execution"> &
  Readonly<{ inputJson: string; executionJson?: string }>;

const executionSchema = Type.Union([
  Type.Object({ state: Type.Literal("starting") }),
  Type.Object({ state: Type.Literal("started"), turn: AgentTurnSchema }),
]);

export function parseQueueWorkerRecord(record: QueueWorkerRecord): AgentQueueRecord {
  const input: unknown = JSON.parse(record.inputJson);
  if (!Value.Check(AgentPromptInputSchema, input)) {
    throw new Error("Persisted task queue input is invalid");
  }
  const { inputJson: _inputJson, executionJson, ...identity } = record;
  if (executionJson === undefined) return { ...identity, input };
  const execution: unknown = JSON.parse(executionJson);
  if (!Value.Check(executionSchema, execution)) {
    throw new Error("Persisted task queue execution is invalid");
  }
  return { ...identity, execution, input };
}
