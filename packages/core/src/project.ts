import type {
  AgentGlobalSettings,
  AgentPromptInput,
  AgentProviderConnectionRecord,
  AgentProjectDefaults,
  AgentQueuedSubmissionStatus,
  AgentTask,
  AgentTaskSettings,
  Project,
  ProjectRootInput,
} from "@codexly/protocol";

export type AgentQueueRecord = Readonly<{
  clientUserMessageId: string;
  id: string;
  input: AgentPromptInput;
  projectId: string;
  status: AgentQueuedSubmissionStatus;
  taskId: string;
}>;

export interface AgentQueueRepository {
  addQueue(record: AgentQueueRecord): Promise<AgentQueueRecord>;
  deleteQueue(projectId: string, taskId: string, queuedSubmissionId: string): Promise<boolean>;
  listQueue(projectId: string, taskId: string): Promise<readonly AgentQueueRecord[]>;
  reorderQueue(
    projectId: string,
    taskId: string,
    queuedSubmissionIds: readonly string[],
  ): Promise<void>;
  updateQueue(
    projectId: string,
    taskId: string,
    queuedSubmissionId: string,
    input: AgentPromptInput,
    status: AgentQueuedSubmissionStatus,
  ): Promise<AgentQueueRecord | undefined>;
}

export type RegisterProjectInput = Readonly<{
  idempotencyKey: string;
  name: string;
  roots: readonly ProjectRootInput[];
}>;

export type ProjectSourceMigration = Readonly<{
  completed: boolean;
  recoverUnassigned: boolean;
}>;

// Project Projection 只保存 Codex 权威对象的本地可查询视图，不生成或解释项目身份。
export interface ProjectProjectionStore {
  completeProjectSourceMigration(): Promise<void>;
  deleteProject(projectId: string): Promise<boolean>;
  list(): Promise<readonly Project[]>;
  migrateProject(legacyProjectId: string, project: Project): Promise<Project>;
  read(projectId: string): Promise<Project | undefined>;
  readProjectSourceMigration(): Promise<ProjectSourceMigration>;
  replaceProjects(projects: readonly Project[]): Promise<readonly Project[]>;
  setProjectOrder(projectIds: readonly string[]): Promise<readonly Project[]>;
  upsertProject(project: Project): Promise<Project>;
}

export interface ProjectRepository {
  list(): Promise<readonly Project[]>;
  read(projectId: string): Promise<Project | undefined>;
  register(input: RegisterProjectInput): Promise<Project>;
  remove(projectId: string): Promise<boolean>;
  rename(projectId: string, name: string): Promise<Project | undefined>;
  reorder(projectIds: readonly string[]): Promise<readonly Project[]>;
}

// 设置端口只接收完整对象，具体事务与数据库实现留在 Server Adapter。
export interface AgentSettingsRepository {
  readGlobalSettings(): Promise<AgentGlobalSettings | undefined>;
  readProjectDefaults(projectId: string): Promise<AgentProjectDefaults | undefined>;
  readTaskSettings(projectId: string, taskId: string): Promise<AgentTaskSettings | undefined>;
  writeProjectDefaults(
    projectId: string,
    settings: AgentProjectDefaults,
  ): Promise<AgentProjectDefaults>;
  writeGlobalSettings(settings: AgentGlobalSettings): Promise<AgentGlobalSettings>;
  writeTaskSettings(
    projectId: string,
    taskId: string,
    settings: AgentTaskSettings,
  ): Promise<AgentTaskSettings>;
}

// Provider 连接记录只持久化模式和模型目录，Secret 始终由具体 Provider 的凭证存储管理。
export interface AgentProviderConnectionRepository {
  readProviderConnection(): Promise<AgentProviderConnectionRecord | undefined>;
  writeProviderConnection(
    record: AgentProviderConnectionRecord,
  ): Promise<AgentProviderConnectionRecord>;
}

export interface TaskRepository {
  listByProject(projectId: string): Promise<readonly AgentTask[]>;
  read(taskId: string): Promise<AgentTask | undefined>;
}
