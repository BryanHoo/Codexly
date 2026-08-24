import type { ReactNode } from "react";

import type { TaskNotifier } from "../notifications/browser-task-notifier.js";
import type { CodexlyWorkbenchClient } from "./project-queries.js";

export type ProjectProviderProps = Readonly<{
  children: ReactNode;
  client?: CodexlyWorkbenchClient;
  taskNotifier?: TaskNotifier;
}>;
