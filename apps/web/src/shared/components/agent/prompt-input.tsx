import { PromptInput as SharedPromptInput } from "@codexly/ui/agent/prompt-input";
import { withAgentLocale } from "./with-agent-locale.js";
export const PromptInput = /* @__PURE__ */ withAgentLocale(SharedPromptInput);
export { createPastedTextFile } from "@codexly/ui/agent/prompt-input";
export * from "./prompt-input-context.js";
export * from "./prompt-input-controls.js";
