import * as Shared from "@codexly/ui/agent/task";
import { withAgentLocale } from "./with-agent-locale.js";
export const Task = /* @__PURE__ */ withAgentLocale(Shared.Task);
export const TaskTrigger = /* @__PURE__ */ withAgentLocale(Shared.TaskTrigger);
export const TaskContent = /* @__PURE__ */ withAgentLocale(Shared.TaskContent);
export const TaskItem = /* @__PURE__ */ withAgentLocale(Shared.TaskItem);
export const TaskItemFile = /* @__PURE__ */ withAgentLocale(Shared.TaskItemFile);
export type {
  TaskStatus,
  TaskContentProps,
  TaskItemProps,
  TaskItemFileProps,
} from "@codexly/ui/agent/task";
