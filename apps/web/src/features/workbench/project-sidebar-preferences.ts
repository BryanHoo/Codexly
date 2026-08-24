const expandedProjectsStorageKey = "codexly:project-sidebar:expanded-projects:v1";
const temporaryTasksExpandedStorageKey = "codexly:project-sidebar:temporary-tasks-expanded:v1";

export type ProjectSidebarPreferenceStorage = Readonly<{
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}>;

type ExpandedProjectsPreference = Readonly<{
  expandedProjectIds: readonly string[];
  version: 1;
}>;

type TemporaryTasksExpandedPreference = Readonly<{
  expanded: boolean;
  version: 1;
}>;

export function getProjectSidebarPreferenceStorage(): ProjectSidebarPreferenceStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    // 浏览器禁用存储时保持侧栏可用，仅跳过跨会话恢复。
    return undefined;
  }
}

export function readExpandedProjectIds(
  storage: ProjectSidebarPreferenceStorage | undefined,
): ReadonlySet<string> | null {
  if (storage === undefined) {
    return null;
  }

  try {
    const serializedPreference = storage.getItem(expandedProjectsStorageKey);
    if (serializedPreference === null) {
      return null;
    }

    const preference: unknown = JSON.parse(serializedPreference);
    if (!isExpandedProjectsPreference(preference)) {
      return null;
    }

    return new Set(preference.expandedProjectIds);
  } catch {
    return null;
  }
}

export function writeExpandedProjectIds(
  storage: ProjectSidebarPreferenceStorage | undefined,
  expandedProjectIds: ReadonlySet<string>,
): void {
  if (storage === undefined) {
    return;
  }

  const preference: ExpandedProjectsPreference = {
    expandedProjectIds: [...expandedProjectIds],
    version: 1,
  };

  try {
    storage.setItem(expandedProjectsStorageKey, JSON.stringify(preference));
  } catch {
    // 配额不足或隐私模式禁止写入时，不阻断当前展开/收起操作。
  }
}

export function readTemporaryTasksExpanded(
  storage: ProjectSidebarPreferenceStorage | undefined,
): boolean {
  if (storage === undefined) {
    return true;
  }

  try {
    const serializedPreference = storage.getItem(temporaryTasksExpandedStorageKey);
    if (serializedPreference === null) {
      return true;
    }

    const preference: unknown = JSON.parse(serializedPreference);
    return isTemporaryTasksExpandedPreference(preference) ? preference.expanded : true;
  } catch {
    return true;
  }
}

export function writeTemporaryTasksExpanded(
  storage: ProjectSidebarPreferenceStorage | undefined,
  expanded: boolean,
): void {
  if (storage === undefined) {
    return;
  }

  const preference: TemporaryTasksExpandedPreference = { expanded, version: 1 };
  try {
    storage.setItem(temporaryTasksExpandedStorageKey, JSON.stringify(preference));
  } catch {
    // 存储不可写时仅保留当前页面状态，不阻断侧栏交互。
  }
}

export function resolveInitialExpandedProjectIds(
  projectIds: readonly string[],
  savedExpandedProjectIds: ReadonlySet<string> | null,
): ReadonlySet<string> {
  if (savedExpandedProjectIds === null) {
    const firstProjectId = projectIds[0];
    return firstProjectId === undefined ? new Set() : new Set([firstProjectId]);
  }

  return new Set(projectIds.filter((projectId) => savedExpandedProjectIds.has(projectId)));
}

export function resolveInitialProjectId(
  projectIds: readonly string[],
  savedExpandedProjectIds: ReadonlySet<string> | null,
): string | undefined {
  const expandedProjectIds = resolveInitialExpandedProjectIds(projectIds, savedExpandedProjectIds);
  // 按侧栏顺序选择首个展开项目；全部收起或偏好失效时仍保留首项回退。
  return projectIds.find((projectId) => expandedProjectIds.has(projectId)) ?? projectIds[0];
}

function isExpandedProjectsPreference(value: unknown): value is ExpandedProjectsPreference {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<ExpandedProjectsPreference>;
  return (
    candidate.version === 1 &&
    Array.isArray(candidate.expandedProjectIds) &&
    candidate.expandedProjectIds.every((projectId) => typeof projectId === "string")
  );
}

function isTemporaryTasksExpandedPreference(
  value: unknown,
): value is TemporaryTasksExpandedPreference {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<TemporaryTasksExpandedPreference>;
  return candidate.version === 1 && typeof candidate.expanded === "boolean";
}
