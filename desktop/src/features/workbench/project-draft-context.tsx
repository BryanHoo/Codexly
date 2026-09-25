import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  createProjectDraftStore,
  type ProjectDraftRecord,
  type ProjectDraftStore,
} from "./project-draft-store.js";

export type ProjectDraftItem = Readonly<{
  projectId: string;
  record: ProjectDraftRecord;
}>;

const ProjectDraftContext = createContext<ProjectDraftStore | undefined>(undefined);

export function ProjectDraftProvider({ children }: Readonly<{ children: ReactNode }>) {
  const storeRef = useRef<ProjectDraftStore>(null);
  storeRef.current ??= createProjectDraftStore();
  return <ProjectDraftContext.Provider value={storeRef.current}>{children}</ProjectDraftContext.Provider>;
}

export function useProjectDraftStore(): ProjectDraftStore {
  const store = useContext(ProjectDraftContext);
  if (store === undefined) {
    throw new Error("useProjectDraftStore must be used inside ProjectDraftProvider");
  }
  return store;
}

export function useProjectDrafts(projectId: string) {
  const store = useProjectDraftStore();
  const getSnapshot = useCallback(() => store.list(projectId), [projectId, store]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

export function useAllProjectDrafts(projectIds: readonly string[]): readonly ProjectDraftItem[] {
  const store = useProjectDraftStore();
  useSyncExternalStore(store.subscribe, store.getRevision, store.getRevision);
  return projectIds.flatMap((projectId) =>
    store.list(projectId).map((record) => ({ projectId, record })),
  );
}
