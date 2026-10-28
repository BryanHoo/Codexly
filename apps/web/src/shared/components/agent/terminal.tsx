import * as Shared from "@codexly/ui/agent/terminal";
import { withAgentLocale } from "./with-agent-locale.js";
export const Terminal = /* @__PURE__ */ withAgentLocale(Shared.Terminal);
export const TerminalHeader = /* @__PURE__ */ withAgentLocale(Shared.TerminalHeader);
export const TerminalTitle = /* @__PURE__ */ withAgentLocale(Shared.TerminalTitle);
export const TerminalActions = /* @__PURE__ */ withAgentLocale(Shared.TerminalActions);
export const TerminalCopyButton = /* @__PURE__ */ withAgentLocale(Shared.TerminalCopyButton);
export const TerminalContent = /* @__PURE__ */ withAgentLocale(Shared.TerminalContent);
export type {
  TerminalProps,
  TerminalHeaderProps,
  TerminalTitleProps,
  TerminalActionsProps,
  TerminalCopyButtonProps,
  TerminalContentProps,
} from "@codexly/ui/agent/terminal";
