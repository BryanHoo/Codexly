import {
  createComposerDraftScope,
  type ComposerDraft,
  type ComposerDraftStore,
} from "./composer-draft-context.js";
import type { ProjectTodoStore } from "./project-todo-store.js";

type ProjectTodoBindingOptions = Readonly<{
  composerDrafts: ComposerDraftStore;
  editingTodoId: string | undefined;
  projectId: string;
  projectTodos: ProjectTodoStore;
  taskId: string | undefined;
}>;

export type ComposerDraftBinding = Readonly<{
  clear: () => void;
  read: () => ComposerDraft;
  scope: string;
  update: (update: (draft: ComposerDraft) => ComposerDraft) => void;
}>;

type ComposerBindingIdentity = Readonly<{ routeScope: string; storageScope: string }>;
const emptyDraft: ComposerDraft = { attachments: [], content: [] };

export function createProjectTodoComposerScope(projectId: string, todoId: string): string {
  return JSON.stringify([projectId, "project-todo", todoId]);
}

export function shouldRestoreComposerBinding(
  previous: ComposerBindingIdentity,
  next: ComposerBindingIdentity,
): boolean {
  return previous.routeScope !== next.routeScope || previous.storageScope !== next.storageScope;
}

export function createProjectTodoBinding({
  composerDrafts,
  editingTodoId,
  projectId,
  projectTodos,
  taskId,
}: ProjectTodoBindingOptions): ComposerDraftBinding {
  if (editingTodoId === undefined) {
    const scope = createComposerDraftScope(projectId, taskId);
    return {
      clear: () => {
        composerDrafts.clear(scope);
      },
      read: () => composerDrafts.read(scope),
      scope,
      update: (update) => {
        composerDrafts.update(scope, update);
      },
    };
  }
  const scope = createProjectTodoComposerScope(projectId, editingTodoId);
  const read = () => {
    const record = projectTodos.read(projectId, editingTodoId);
    return record?.workingDraft ?? record?.draft ?? emptyDraft;
  };
  return {
    clear: () => {
      projectTodos.updateWorking(projectId, editingTodoId, emptyDraft);
    },
    read,
    scope,
    update: (update) => {
      projectTodos.updateWorking(projectId, editingTodoId, update(read()));
    },
  };
}
