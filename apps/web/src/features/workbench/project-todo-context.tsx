import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  createProjectTodoStore,
  type ProjectTodoRecord,
  type ProjectTodoStore,
} from "./project-todo-store.js";

export type ProjectTodoItem = Readonly<{ projectId: string; record: ProjectTodoRecord }>;
const ProjectTodoContext = createContext<ProjectTodoStore | undefined>(undefined);

export function ProjectTodoProvider({ children }: Readonly<{ children: ReactNode }>) {
  const storeRef = useRef<ProjectTodoStore>(null);
  storeRef.current ??= createProjectTodoStore();
  return (
    <ProjectTodoContext.Provider value={storeRef.current}>{children}</ProjectTodoContext.Provider>
  );
}

export function useProjectTodoStore(): ProjectTodoStore {
  const store = useContext(ProjectTodoContext);
  if (store === undefined)
    throw new Error("useProjectTodoStore must be used inside ProjectTodoProvider");
  return store;
}

export function useProjectTodos(projectId: string) {
  const store = useProjectTodoStore();
  const getSnapshot = useCallback(() => store.list(projectId), [projectId, store]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

export function useAllProjectTodos(projectIds: readonly string[]): readonly ProjectTodoItem[] {
  const store = useProjectTodoStore();
  useSyncExternalStore(store.subscribe, store.getRevision, store.getRevision);
  return projectIds.flatMap((projectId) =>
    store.list(projectId).map((record) => ({ projectId, record })),
  );
}
