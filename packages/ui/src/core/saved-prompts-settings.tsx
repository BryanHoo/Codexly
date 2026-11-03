import { toast } from "./notifications.js";
import { Bookmark, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { lazy, Suspense, useMemo, useRef, useState } from "react";
import type { SavedPrompt, SavedPromptDraft } from "@codexly/frontend-core/saved-prompts";
import { Button } from "./button.js";
import { Input } from "./input.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog.js";
import {
  removeSharedPrompt,
  useSavedPrompts,
  useSavedPromptsStatus,
  refreshSavedPrompts,
} from "./saved-prompts-store.js";
import { savedPromptsCopy } from "./saved-prompts-copy.js";

const SavedPromptEditor = lazy(() => import("./saved-prompt-editor.js"));

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
  const syncStatus = useSavedPromptsStatus();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const projectNames = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );
  const [scope, setScope] = useState("all");
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<{ original: SavedPromptDraft; id?: string }>();
  const [deleting, setDeleting] = useState<SavedPrompt>();
  const [error, setError] = useState<keyof typeof copy.errors>();
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
  const openEditor = (prompt?: SavedPrompt) => {
    setEditor({ original: prompt ?? emptyDraft, ...(prompt ? { id: prompt.id } : {}) });
  };
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
      {syncStatus === "error" ? (
        <div role="alert" className="space-y-2 text-body-small text-danger">
          <p>{copy.loadError}</p>
          <Button type="button" variant="ghost" onClick={refreshSavedPrompts}>
            {copy.retry}
          </Button>
        </div>
      ) : syncStatus === "loading" ? (
        <p role="status">{copy.loading}</p>
      ) : null}
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

      {editor ? (
        <Suspense fallback={null}>
          <SavedPromptEditor
            language={language}
            initialDraft={editor.original}
            promptId={editor.id}
            projects={projects}
            onClose={() => {
              setEditor(undefined);
            }}
          />
        </Suspense>
      ) : null}

      <Dialog
        open={deleting !== undefined}
        onOpenChange={(open) => {
          if (!open && !busy.current) setDeleting(undefined);
        }}
      >
        <DialogContent closeLabel={copy.close}>
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
              disabled={pending}
              autoFocus
              onClick={() => {
                if (busy.current) return;
                setDeleting(undefined);
              }}
            >
              {copy.cancel}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={() => {
                void (async () => {
                  if (!deleting || busy.current) return;
                  try {
                    busy.current = true;
                    setPending(true);
                    await removeSharedPrompt(deleting.id);
                    setDeleting(undefined);
                    toast.success(copy.deleted);
                  } catch {
                    setError("storage");
                  } finally {
                    busy.current = false;
                    setPending(false);
                  }
                })();
              }}
            >
              {copy.confirmDelete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
