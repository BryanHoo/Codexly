import {
  createComposerDraftScope,
  type ComposerDraft,
  type ComposerDraftStore,
} from "./composer-draft-context.js";
import type { ProjectDraftStore } from "./project-draft-store.js";

type ComposerDraftBindingOptions = Readonly<{
  composerDrafts: ComposerDraftStore;
  editingDraftId: string | undefined;
  projectDrafts: ProjectDraftStore;
  projectId: string;
  taskId: string | undefined;
}>;

export type ComposerDraftBinding = Readonly<{
  clear: () => void;
  read: () => ComposerDraft;
  scope: string;
  update: (update: (draft: ComposerDraft) => ComposerDraft) => void;
}>;

type ComposerBindingIdentity = Readonly<{
  routeScope: string;
  storageScope: string;
}>;

const emptyDraft: ComposerDraft = { attachments: [], content: [] };

export function createProjectDraftComposerScope(projectId: string, draftId: string): string {
  return JSON.stringify([projectId, "project-draft", draftId]);
}

export function shouldRestoreComposerBinding(
  previous: ComposerBindingIdentity,
  next: ComposerBindingIdentity,
): boolean {
  return previous.routeScope !== next.routeScope || previous.storageScope !== next.storageScope;
}

export function createComposerDraftBinding({
  composerDrafts,
  editingDraftId,
  projectDrafts,
  projectId,
  taskId,
}: ComposerDraftBindingOptions): ComposerDraftBinding {
  if (editingDraftId === undefined) {
    const scope = createComposerDraftScope(projectId, taskId);
    return {
      clear: () => composerDrafts.clear(scope),
      read: () => composerDrafts.read(scope),
      scope,
      update: (update) => composerDrafts.update(scope, update),
    };
  }
  const scope = createProjectDraftComposerScope(projectId, editingDraftId);
  const read = () => {
    const record = projectDrafts.read(projectId, editingDraftId);
    return record?.workingDraft ?? record?.draft ?? emptyDraft;
  };
  const update = (applyUpdate: (draft: ComposerDraft) => ComposerDraft) => {
    projectDrafts.updateWorking(projectId, editingDraftId, applyUpdate(read()));
  };
  return {
    clear: () => projectDrafts.updateWorking(projectId, editingDraftId, emptyDraft),
    read,
    scope,
    update,
  };
}
