import type { AgentCapabilities } from "@codexly/protocol";

export const CLAUDE_CAPABILITIES: AgentCapabilities = {
  provider: "claude",
  feedback: { upload: false },
  goals: { clear: false, read: false, update: false },
  skills: { list: false, use: false },
  tasks: { fork: true, list: true, read: true, start: true },
  turns: { compact: true, interrupt: true, review: false, start: true, steer: false },
};
