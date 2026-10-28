import * as Shared from "@codexly/ui/agent/context";
import { i18n } from "../../../i18n/i18n.js";
import { withAgentLocale } from "./with-agent-locale.js";
export const Context = /* @__PURE__ */ withAgentLocale(Shared.Context);
export const ContextTrigger = /* @__PURE__ */ withAgentLocale(Shared.ContextTrigger);
export const ContextContent = /* @__PURE__ */ withAgentLocale(Shared.ContextContent);
export const ContextContentHeader = /* @__PURE__ */ withAgentLocale(Shared.ContextContentHeader);
export function formatContextUsage(usage: Parameters<typeof Shared.formatContextUsage>[0]) {
  return Shared.formatContextUsage(usage, (key, values) =>
    i18n.t(key, { ...values, ns: "conversation" }),
  );
}
export type {
  ContextProps,
  ContextTriggerProps,
  ContextContentProps,
  ContextContentHeaderProps,
} from "@codexly/ui/agent/context";
