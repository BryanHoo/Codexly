import type { AgentMessageAttachment, AgentPromptInput, AgentTurn } from "@codexly/protocol";

export type SubmittedPromptState = Readonly<{
  input: AgentPromptInput;
  messageAttachments: readonly AgentMessageAttachment[];
  submissionStartedAt?: string;
  turn: AgentTurn;
}>;

export type WorkbenchShellProps = Readonly<{
  board?: boolean;
  extensionSection?: string;
  projectId: string;
  scheduled?: boolean;
  taskId?: string;
  temporary?: boolean;
  todoId?: string;
}>;
