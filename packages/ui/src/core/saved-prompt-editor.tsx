import { useId, useMemo, useRef, useState } from "react";
import {
  savedPromptLimits,
  validateSavedPrompt,
  type SavedPromptDraft,
} from "@codexly/frontend-core/saved-prompts";
import { Button } from "./button.js";
import { Input } from "./input.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select.js";
import { Textarea } from "./textarea.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog.js";
import { saveSharedPrompt } from "./saved-prompts-store.js";
import { savedPromptsCopy } from "./saved-prompts-copy.js";
import { toast } from "./notifications.js";

export type PromptProject = Readonly<{ id: string; name: string }>;
const noProjects: readonly PromptProject[] = [];

/** 设置页与发送菜单复用同一个编辑器；初始正文只在打开时复制，避免覆盖用户后续编辑。 */
export default function SavedPromptEditor({
  language,
  initialDraft,
  promptId,
  projects = noProjects,
  onClose,
}: Readonly<{
  language: string;
  initialDraft: SavedPromptDraft;
  promptId?: string | undefined;
  projects?: readonly PromptProject[] | undefined;
  onClose: () => void;
}>) {
  const copy = savedPromptsCopy(language);
  const id = useId();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState(initialDraft);
  const [discarding, setDiscarding] = useState(false);
  const [error, setError] = useState<keyof typeof copy.errors>();
  const projectNames = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );
  const dirty =
    draft.name !== initialDraft.name ||
    draft.content !== initialDraft.content ||
    draft.projectId !== initialDraft.projectId;
  const closeEditor = () => {
    if (busy.current) return;
    if (dirty) setDiscarding(true);
    else onClose();
  };
  const save = async () => {
    if (busy.current) return;
    const invalid =
      draft.projectId !== undefined && !projectNames.has(draft.projectId)
        ? "project"
        : validateSavedPrompt(draft);
    if (invalid) {
      setError(invalid);
      return;
    }
    try {
      busy.current = true;
      setPending(true);
      await saveSharedPrompt(draft, promptId);
      onClose();
      toast.success(copy.saved);
    } catch (cause) {
      setError(
        cause instanceof Error &&
          (cause.message === "duplicate" || ("status" in cause && cause.status === 409))
          ? "duplicate"
          : "storage",
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  const update = (field: keyof SavedPromptDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setError(undefined);
  };
  const errorId = `${id}-error`;
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) closeEditor();
        }}
      >
        <DialogContent
          closeLabel={copy.close}
          className="max-w-xl"
          closeDisabled={pending}
          onInteractOutside={(event) => {
            event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>{promptId ? copy.editTitle : copy.add}</DialogTitle>
            <DialogDescription>{copy.insertHint}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              // Portal 仍沿 React 树冒泡，阻止提示词保存触发外层聊天提交。
              event.stopPropagation();
              void save();
            }}
          >
            <div className="space-y-1.5">
              <label htmlFor={`${id}-name`} className="text-body-small font-medium">
                {copy.name}
              </label>
              <Input
                id={`${id}-name`}
                autoFocus
                maxLength={savedPromptLimits.name}
                value={draft.name}
                placeholder={copy.namePlaceholder}
                aria-invalid={error === "name" || error === "duplicate"}
                aria-describedby={error === "name" || error === "duplicate" ? errorId : undefined}
                onChange={(event) => {
                  update("name", event.currentTarget.value);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <label id={`${id}-scope-label`} className="text-body-small font-medium">
                {copy.scope}
              </label>
              <Select
                value={draft.projectId ? `project:${draft.projectId}` : "global"}
                onValueChange={(value) => {
                  setDraft((current) => {
                    const { projectId: _projectId, ...fields } = current;
                    return value === "global" ? fields : { ...fields, projectId: value.slice(8) };
                  });
                  setError(undefined);
                }}
              >
                <SelectTrigger
                  className="w-full"
                  aria-labelledby={`${id}-scope-label`}
                  aria-describedby={`${id}-scope-hint${error === "project" ? ` ${errorId}` : ""}`}
                  aria-invalid={error === "project"}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" className="max-w-[calc(100vw-2rem)]">
                  <SelectItem value="global">{copy.global}</SelectItem>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={`project:${project.id}`}>
                      {project.name}
                    </SelectItem>
                  ))}
                  {draft.projectId && !projectNames.has(draft.projectId) ? (
                    <SelectItem disabled value={`project:${draft.projectId}`}>
                      {copy.unavailable}
                    </SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
              <p
                id={`${id}-scope-hint`}
                className="text-label leading-relaxed text-muted-foreground"
              >
                {copy.scopeHint}
              </p>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor={`${id}-content`} className="text-body-small font-medium">
                  {copy.content}
                </label>
                <span className="text-label tabular-nums text-subtle-foreground">
                  {draft.content.length} / {savedPromptLimits.content}
                </span>
              </div>
              <Textarea
                id={`${id}-content`}
                className="min-h-48 text-body-small leading-relaxed"
                maxLength={savedPromptLimits.content}
                value={draft.content}
                placeholder={copy.contentPlaceholder}
                aria-invalid={error === "content"}
                aria-describedby={error === "content" ? errorId : undefined}
                onChange={(event) => {
                  update("content", event.currentTarget.value);
                }}
              />
            </div>
            {error ? (
              <p id={errorId} role="alert" className="text-body-small text-danger">
                {copy.errors[error]}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="ghost" disabled={pending} onClick={closeEditor}>
                {copy.cancel}
              </Button>
              <Button type="submit" disabled={pending}>
                {copy.save}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {/* 脏草稿只有明确放弃才丢弃，Escape 与取消共用同一保护流程。 */}
      {discarding ? (
        <Dialog open onOpenChange={setDiscarding}>
          <DialogContent closeLabel={copy.close}>
            <DialogHeader>
              <DialogTitle>{copy.discardTitle}</DialogTitle>
              <DialogDescription>{copy.discardDescription}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                autoFocus
                onClick={() => {
                  setDiscarding(false);
                }}
              >
                {copy.continue}
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  setDiscarding(false);
                  onClose();
                }}
              >
                {copy.discard}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
