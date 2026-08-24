import type {
  ProjectFileSearchEntry,
  ProjectOpenApp,
  ProjectOpenAppId,
} from "@code-agent/protocol";
import { RefreshCw } from "lucide-react";
import { useRef, useState } from "react";

import { i18n } from "../../../i18n/i18n.js";
import { FileTreeActions } from "../../../shared/components/agent/file-tree.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";
import { ProjectOpenDropdownMenu } from "./project-open-menu.js";

export function ProjectFileTreeRootActions({
  onMenuOpen,
  onOpenProjectPath,
  onReferenceProjectPath,
  onRefreshProject,
  projectName,
  projectOpenApps,
  projectOpenPending,
  projectPath,
  refreshing = false,
}: Readonly<{
  onMenuOpen: () => void;
  onOpenProjectPath: (appId: ProjectOpenAppId) => void;
  onReferenceProjectPath: (entry: ProjectFileSearchEntry) => void;
  onRefreshProject: () => unknown;
  projectName: string;
  projectOpenApps: readonly ProjectOpenApp[];
  projectOpenPending: boolean;
  projectPath: string;
  refreshing?: boolean;
}>) {
  const refreshLockRef = useRef(false);
  const [refreshPending, setRefreshPending] = useState(false);
  const isRefreshing = refreshing || refreshPending;
  const refreshLabel = i18n.t("inspector.refreshProject", {
    name: projectName,
    ns: "conversation",
  });

  return (
    <FileTreeActions>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label={refreshLabel}
            className={`size-5 shrink-0 transition-opacity ${
              isRefreshing
                ? "pointer-events-auto opacity-100"
                : "pointer-events-none opacity-0 group-hover/file-tree-node:pointer-events-auto group-hover/file-tree-node:opacity-100 group-focus-within/file-tree-node:pointer-events-auto group-focus-within/file-tree-node:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
            }`}
            disabled={isRefreshing}
            onClick={() => {
              if (refreshLockRef.current) return;
              refreshLockRef.current = true;
              setRefreshPending(true);
              void Promise.resolve()
                .then(onRefreshProject)
                .finally(() => {
                  refreshLockRef.current = false;
                  setRefreshPending(false);
                });
            }}
            size="embedded"
            type="button"
            variant="embedded"
          >
            <RefreshCw
              aria-hidden="true"
              className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`}
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">{refreshLabel}</TooltipContent>
      </Tooltip>
      <ProjectOpenDropdownMenu
        apps={projectOpenApps}
        isPending={projectOpenPending}
        onOpen={onMenuOpen}
        onReference={onReferenceProjectPath}
        onSelect={onOpenProjectPath}
        target={{
          absolutePath: projectPath,
          path: projectPath,
          relativePath: ".",
          type: "directory",
        }}
      />
    </FileTreeActions>
  );
}
