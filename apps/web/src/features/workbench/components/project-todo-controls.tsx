import { FilePenLine, FilePlus2, Trash2 } from "lucide-react";
import { useState } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { PromptInputButton } from "../../../shared/components/agent/prompt-input.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../shared/components/core/dialog.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../../shared/components/core/popover.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";
import type { ProjectTodoRecord } from "../project-todo-store.js";
import { getProjectTodoSummary } from "../project-todo-summary.js";

export function ComposerTodoSaveButton({
  disabled,
  editing,
  onSave,
}: Readonly<{ disabled: boolean; editing: boolean; onSave: () => void }>) {
  const { t } = useTranslation("workbench");
  const label = t(editing ? "composer.saveTodoChanges" : "composer.saveAsTodo");
  const Icon = editing ? FilePenLine : FilePlus2;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <PromptInputButton aria-label={label} disabled={disabled} onClick={onSave}>
          <Icon aria-hidden="true" className="size-3.5" />
        </PromptInputButton>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function ProjectTodoList({
  composerHasInput,
  onDelete,
  onRestore,
  projectName,
  todos,
}: Readonly<{
  composerHasInput: boolean;
  onDelete: (todoId: string) => void;
  onRestore: (todoId: string) => void;
  projectName: string;
  todos: readonly ProjectTodoRecord[];
}>) {
  const { t, i18n } = useTranslation("workbench");
  const [open, setOpen] = useState(false);
  const [pendingTodoId, setPendingTodoId] = useState<string>();
  if (todos.length === 0) return null;
  const restore = (todoId: string) => {
    setOpen(false);
    if (composerHasInput) setPendingTodoId(todoId);
    else onRestore(todoId);
  };
  return (
    <>
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger asChild>
          <Button
            aria-label={t("composer.todoCount", { count: todos.length })}
            className="h-6 px-1.5 text-caption"
            size="toolbar"
            type="button"
            variant="ghost"
          >
            {t("composer.todoCount", { count: todos.length })}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          aria-label={t("composer.todoList", { project: projectName })}
          className="w-96 max-w-[calc(100vw-2rem)] overflow-hidden p-0"
          role="dialog"
          side="top"
        >
          <div className="border-b border-separator px-3 py-2 text-label font-medium">
            {t("composer.todoList", { project: projectName })}
          </div>
          <div className="max-h-72 overflow-y-auto p-1" role="list">
            {todos.map((todo) => {
              const summary = getProjectTodoSummary(
                todo,
                t("composer.attachmentCount", { count: todo.draft.attachments.length }),
              );
              return (
                <div
                  className="group flex h-11 min-w-0 items-center gap-1"
                  key={todo.id}
                  role="listitem"
                >
                  <Button
                    aria-label={summary}
                    className="h-full min-w-0 flex-1 px-2 py-1"
                    contentAlign="start"
                    onClick={() => {
                      restore(todo.id);
                    }}
                    type="button"
                    variant="ghost"
                  >
                    <span className="min-w-0 flex-1 overflow-hidden">
                      <span className="block truncate text-body-small text-foreground">
                        {summary}
                      </span>
                      <span className="mt-px flex min-w-0 items-center gap-2 text-caption text-muted-foreground">
                        <span className="truncate">
                          {new Date(todo.updatedAt).toLocaleString(i18n.language)}
                        </span>
                        {todo.workingDraft === undefined ? null : (
                          <span className="shrink-0 text-brand">
                            {t("composer.todoHasChanges")}
                          </span>
                        )}
                      </span>
                    </span>
                  </Button>
                  <Button
                    aria-label={t("composer.deleteTodo", { summary })}
                    className="mr-1 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                    onClick={() => {
                      onDelete(todo.id);
                    }}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 aria-hidden="true" className="size-3.5" />
                  </Button>
                </div>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
      <Dialog
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setPendingTodoId(undefined);
        }}
        open={pendingTodoId !== undefined}
      >
        <DialogContent className="max-w-96 p-4">
          <DialogHeader>
            <DialogTitle>{t("composer.applyTodoTitle")}</DialogTitle>
            <DialogDescription>{t("composer.applyTodoDescription")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              onClick={() => {
                setPendingTodoId(undefined);
              }}
              type="button"
              variant="ghost"
            >
              {t("actions.cancel")}
            </Button>
            <Button
              onClick={() => {
                const todoId = pendingTodoId;
                setPendingTodoId(undefined);
                if (todoId !== undefined) onRestore(todoId);
              }}
              type="button"
            >
              {t("composer.applyTodo")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
