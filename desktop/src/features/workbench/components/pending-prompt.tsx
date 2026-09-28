import type { AgentSkill } from "@/protocol/index.js";

import { Message } from "../../../shared/components/agent/message.js";
import type { PromptInputAttachment } from "../../../shared/components/agent/prompt-input.js";
import { RunningReplyStatus } from "./task-timeline-running.js";
import { TurnProcessingTime } from "./task-timeline-status.js";

export type PendingPrompt = Readonly<{
  files: readonly PromptInputAttachment[];
  skills: readonly AgentSkill[];
  text: string;
}>;

export function PendingPromptDisplay({
  prompt,
  startedAt,
}: Readonly<{ prompt: PendingPrompt; startedAt?: string }>) {
  return (
    <div className="space-y-4">
      <Message from="user">
        <div className="whitespace-pre-wrap">{prompt.text}</div>
        {prompt.skills.length > 0 ? (
          <div>{prompt.skills.map((skill) => `$${skill.name}`).join(" ")}</div>
        ) : null}
        {prompt.files.length > 0 ? (
          <div className="text-muted-foreground">
            {prompt.files.map((file) => file.name).join(", ")}
          </div>
        ) : null}
      </Message>
      {startedAt === undefined ? null : (
        <Message from="assistant">
          <TurnProcessingTime completedAt={null} startedAt={startedAt} />
          <RunningReplyStatus />
        </Message>
      )}
    </div>
  );
}
