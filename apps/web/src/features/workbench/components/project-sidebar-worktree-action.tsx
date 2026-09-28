import type { Project } from "@codexly/protocol";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { GitBranchPlus } from "lucide-react";
import { useState } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";
import { notifyActionError } from "../../notifications/action-notifications.js";
import { CreateWorktreeDialog } from "./create-worktree-dialog.js";
import {
  createWorktreeBoundTask,
  type WorktreeTaskClient,
} from "./project-sidebar-worktree-task.js";

export function ProjectSidebarWorktreeAction({
  client,
  onCreated,
  project,
}: Readonly<{
  client: WorktreeTaskClient;
  onCreated: (projectId: string) => void;
  project: Project;
}>) {
  const { t } = useTranslation("workbench");
  const [dialogOpen, setDialogOpen] = useState(false);
  const rootPath = project.roots[0]?.path;
  const label = t("sidebar.createWorktreeTask", { project: project.name });

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label={label}
            className="opacity-0 transition-[color,background-color,opacity] focus-visible:opacity-100 group-hover/project:opacity-100"
            disabled={rootPath === undefined}
            onClick={() => {
              setDialogOpen(true);
            }}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <GitBranchPlus className="size-3.5" aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      {dialogOpen && rootPath !== undefined ? (
        <ProjectSidebarWorktreeDialog
          client={client}
          onClose={() => {
            setDialogOpen(false);
          }}
          onCreated={onCreated}
          projectId={project.id}
          rootPath={rootPath}
        />
      ) : null}
    </>
  );
}

function ProjectSidebarWorktreeDialog({
  client,
  onClose,
  onCreated,
  projectId,
  rootPath,
}: Readonly<{
  client: WorktreeTaskClient;
  onClose: () => void;
  onCreated: (projectId: string) => void;
  projectId: string;
  rootPath: string;
}>) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isPending, setIsPending] = useState(false);
  const [pendingWorktreePath, setPendingWorktreePath] = useState<string>();

  const createTask = async (branch: string): Promise<boolean> => {
    setIsPending(true);
    try {
      const result = await createWorktreeBoundTask(
        client,
        queryClient,
        projectId,
        rootPath,
        branch,
        pendingWorktreePath,
      );
      if ("error" in result) {
        setPendingWorktreePath(result.worktreePath);
        notifyActionError(result.error);
        return false;
      } else {
        onCreated(projectId);
        await navigate({
          params: { projectId, taskId: result.task.id },
          to: "/p/$projectId/t/$taskId",
        });
      }
      return true;
    } catch (error) {
      notifyActionError(error);
      return false;
    } finally {
      setIsPending(false);
    }
  };

  return (
    <CreateWorktreeDialog
      branchLocked={pendingWorktreePath !== undefined}
      isPending={isPending}
      onClose={onClose}
      onCreate={createTask}
    />
  );
}
