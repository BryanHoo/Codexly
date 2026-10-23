import { toast } from "./notifications.js";
import { Bookmark, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useId, useMemo, useState } from "react";
import {
  savedPromptLimits,
  validateSavedPrompt,
  type SavedPrompt,
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
import { savedPromptsStore, useSavedPrompts } from "./saved-prompts-store.js";
import { savedPromptsCopy } from "./saved-prompts-copy.js";

const emptyDraft: SavedPromptDraft = { name: "", content: "" };

type PromptProject = Readonly<{ id: string; name: string }>;
const noProjects: readonly PromptProject[] = [];

/** Web、移动浏览器与桌面共用管理流程，复用平台已加载的项目，不额外发起请求。 */
export function SavedPromptsSettings({
  language,
  projects = noProjects,
  projectsUnavailable = false,
}: Readonly<{
  language: string;
  projects?: readonly PromptProject[] | undefined;
  projectsUnavailable?: boolean;
}>) {
  const copy = savedPromptsCopy(language);
  const prompts = useSavedPrompts();
  const projectNames = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );
  const [scope, setScope] = useState("all");
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<{ original: SavedPromptDraft; id?: string }>();
  const [draft, setDraft] = useState<SavedPromptDraft>(emptyDraft);
  const [deleting, setDeleting] = useState<SavedPrompt>();
  const [discarding, setDiscarding] = useState(false);
  const [error, setError] = useState<keyof typeof copy.errors>();
  const id = useId();
  const query = search.trim().toLocaleLowerCase();
  const filtered = useMemo(
    () =>
      prompts.filter(
        (prompt) =>
          (scope === "all" ||
            (scope === "global"
              ? prompt.projectId === undefined
              : prompt.projectId !== undefined && `project:${prompt.projectId}` === scope)) &&
          [prompt.name, prompt.content].some((value) => value.toLocaleLowerCase().includes(query)),
      ),
    [prompts, scope, query],
  );
  const dirty =
    editor &&
    (draft.name !== editor.original.name ||
      draft.content !== editor.original.content ||
      draft.projectId !== editor.original.projectId);
  const openEditor = (prompt?: SavedPrompt) => {
    const original = prompt ?? emptyDraft;
    setEditor({ original, ...(prompt ? { id: prompt.id } : {}) });
    setDraft(original);
    setError(undefined);
  };
  const closeEditor = () => {
    if (dirty) setDiscarding(true);
    else setEditor(undefined);
  };
  const save = () => {
    const invalid =
      draft.projectId !== undefined && !projectNames.has(draft.projectId)
        ? "project"
        : validateSavedPrompt(draft);
    if (invalid) {
      setError(invalid);
      return;
    }
    try {
      savedPromptsStore.save(draft, editor?.id);
      setEditor(undefined);
      toast.success(copy.saved);
    } catch (cause) {
      setError(cause instanceof Error && cause.message === "duplicate" ? "duplicate" : "storage");
    }
  };
  const update = (field: keyof SavedPromptDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setError(undefined);
  };
  const errorId = `${id}-error`;
  return (
    <section id="settings-panel-prompts" className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold">{copy.title}</h1>
        <p className="text-body-small text-muted-foreground">{copy.description}</p>
        <p className="flex items-center gap-1.5 text-label text-subtle-foreground">
          <Bookmark aria-hidden="true" className="size-3.5" />
          {copy.local}
        </p>
      </header>
      {projectsUnavailable ? (
        <p role="status" className="text-body-small text-muted-foreground">
          {copy.projectsUnavailable}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 basis-full sm:basis-48">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label={copy.search}
            placeholder={copy.searchPlaceholder}
            value={search}
            onChange={(event) => {
              setSearch(event.currentTarget.value);
            }}
            className="pl-9"
          />
        </div>
        <Select value={scope} onValueChange={setScope}>
          <SelectTrigger
            aria-label={copy.filter}
            className="min-w-0 flex-1 basis-36 sm:w-44 sm:flex-none sm:basis-auto"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" className="max-w-[calc(100vw-2rem)]">
            <SelectItem value="all">{copy.all}</SelectItem>
            <SelectItem value="global">{copy.global}</SelectItem>
            {projects.map((project) => (
              <SelectItem key={project.id} value={`project:${project.id}`}>
                {project.name}
              </SelectItem>
            ))}
            {scope.startsWith("project:") && !projectNames.has(scope.slice(8)) ? (
              <SelectItem value={scope}>{copy.unavailable}</SelectItem>
            ) : null}
          </SelectContent>
        </Select>
        <Button
          type="button"
          onClick={() => {
            openEditor();
          }}
        >
          <Plus aria-hidden="true" />
          {copy.add}
        </Button>
      </div>
      {filtered.length ? (
        <ul className="divide-y divide-separator overflow-hidden rounded-surface border border-separator bg-panel">
          {filtered.map((prompt) => (
            <li key={prompt.id} className="group flex flex-wrap items-start gap-3 p-4">
              <div className="min-w-0 flex-1 basis-48 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="break-words text-body-small font-medium">{prompt.name}</span>
                </div>
                <p
                  className="truncate text-label text-subtle-foreground"
                  title={
                    prompt.projectId
                      ? (projectNames.get(prompt.projectId) ?? copy.unavailable)
                      : copy.global
                  }
                >
                  {prompt.projectId
                    ? (projectNames.get(prompt.projectId) ?? copy.unavailable)
                    : copy.global}
                </p>
                <p className="line-clamp-2 whitespace-pre-wrap break-words text-body-small leading-relaxed text-muted-foreground">
                  {prompt.content}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`${copy.edit}${prompt.name}`}
                  onClick={() => {
                    openEditor(prompt);
                  }}
                >
                  <Pencil aria-hidden="true" />
                  {copy.edit}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`${copy.remove}${prompt.name}`}
                  onClick={() => {
                    setError(undefined);
                    setDeleting(prompt);
                  }}
                >
                  <Trash2 aria-hidden="true" />
                  {copy.remove}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-surface border border-dashed border-separator-strong px-5 py-12 text-center">
          <Bookmark aria-hidden="true" className="size-7 text-subtle-foreground" />
          <h2 className="text-body font-medium">{prompts.length ? copy.noMatch : copy.empty}</h2>
          <p className="max-w-sm text-body-small leading-relaxed text-muted-foreground">
            {prompts.length ? copy.noMatchDescription : copy.emptyDescription}
          </p>
          {search || scope !== "all" ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setSearch("");
                setScope("all");
              }}
            >
              {copy.clear}
            </Button>
          ) : null}
        </div>
      )}

      <Dialog
        open={editor !== undefined}
        onOpenChange={(open) => {
          if (!open) closeEditor();
        }}
      >
        <DialogContent
          className="max-w-xl"
          onInteractOutside={(event) => {
            event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>{editor?.id ? copy.editTitle : copy.add}</DialogTitle>
            <DialogDescription>{copy.insertHint}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              save();
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
              <Button type="button" variant="ghost" onClick={closeEditor}>
                {copy.cancel}
              </Button>
              <Button type="submit">{copy.save}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleting !== undefined}
        onOpenChange={(open) => {
          if (!open) setDeleting(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copy.deleteTitle}</DialogTitle>
            <DialogDescription>{copy.deleteDescription}</DialogDescription>
          </DialogHeader>
          <p className="break-words text-body-small font-medium">{deleting?.name}</p>
          {error === "storage" ? (
            <p role="alert" className="text-body-small text-danger">
              {copy.errors.storage}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              autoFocus
              onClick={() => {
                setDeleting(undefined);
              }}
            >
              {copy.cancel}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (!deleting) return;
                try {
                  savedPromptsStore.remove(deleting.id);
                  setDeleting(undefined);
                  toast.success(copy.deleted);
                } catch {
                  setError("storage");
                }
              }}
            >
              {copy.confirmDelete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 脏草稿只有明确放弃才丢弃，Escape 与取消共用同一保护流程。 */}
      {discarding ? (
        <Dialog open onOpenChange={setDiscarding}>
          <DialogContent>
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
                  setEditor(undefined);
                }}
              >
                {copy.discard}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </section>
  );
}
