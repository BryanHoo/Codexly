import type { AgentImageMediaType } from "@codexly/protocol";

export function detectImageMediaType(content: Uint8Array): AgentImageMediaType | undefined;
