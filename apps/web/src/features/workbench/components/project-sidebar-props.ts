import type { AgentEventConnectionState } from "@codexly/client";
import type { AppInfoResponse } from "@codexly/protocol";

import type { SearchFile } from "../../search/search-files.js";
import type { SidebarSettingsSection } from "./project-sidebar-actions.js";

export type ProjectSidebarProps = Readonly<{
  appInfo?: AppInfoResponse;
  appUpdate: Readonly<{
    isUpdatePending: boolean;
    onUpdate: (version: string) => Promise<void>;
    updatePercentage?: number;
  }>;
  connectionState: AgentEventConnectionState;
  onClose: () => void;
  onOpenSettings: (section: SidebarSettingsSection) => void;
  onOpenFile: (file: SearchFile, kind: "image" | "source" | "pdf") => void;
  projectId?: string;
  taskId?: string;
}>;
