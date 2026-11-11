import type { AcpScheduledPlanDefinition } from "@codexly/protocol/acp-scheduled-plan";
import type {
  AgentMessageAttachment,
  AcpConfigValues,
  AgentEngine,
  SavedPromptsRequest,
  SharedSavedPrompt,
} from "@codexly/protocol";
/** 应用目录与任务独立于执行引擎；sessionId 仅用于适配器恢复会话。 */
export interface LocalProject {
  id: string;
  name: string;
  path: string;
  createdAt: string;
}

export interface LocalTask {
  id: string;
  projectId: string | null;
  title: string;
  /** 首条输入的持久预览；与正式名称分离，不能阻止后续自动生成。 */
  preview?: string;
  cwd: string;
  provider: string;
  sessionId: string | null;
  updatedAt: number;
  pinned: boolean;
  archived: boolean;
  status: string;
}

export interface LocalTaskQuery {
  providers?: readonly ("codex" | "claude")[];
  projectId?: string | null;
  archived?: boolean;
  completed?: boolean;
  pinned?: boolean;
  searchTerm?: string;
  cursor?: string | null;
  limit?: number;
}

/** 与旧计划分离的 ACP 配置；来源区分 Web / 桌面各自的旧计划身份。 */
export interface AcpScheduledConfigKey {
  source: "web" | "desktop";
  scheduleId: string;
}
export interface AcpScheduledConfig extends AcpScheduledConfigKey {
  engine: AgentEngine;
  values: AcpConfigValues;
  revision: number;
}
export interface AcpScheduledPlan extends AcpScheduledConfigKey {
  definition: AcpScheduledPlanDefinition;
  revision: number;
}
export interface AcpPlanState {
  revision: number;
  definitionRevision: number;
  nextRunAt: number | null;
}
export interface AcpPlanRun {
  runId: string;
  status: "claimed" | "unknown" | "started" | "failed";
  claimedAt: number;
  definitionRevision: number;
  definition: AcpScheduledPlanDefinition | null;
  taskId: string | null;
  error: string | null;
}
export interface AcpPlanDueCursor {
  nextRunAt: number;
  scheduleId: string;
}
export interface AcpPlanMetadata
  extends
    AcpScheduledConfigKey,
    Pick<AcpScheduledPlanDefinition, "name" | "projectId" | "engine" | "enabled" | "schedule"> {
  revision: number;
  stateRevision: number | null;
  scheduledRevision: number | null;
  nextRunAt: number | null;
}
export interface AcpPlanResourceScope {
  source: "web" | "desktop";
  scheduleId: string;
  projectId: string;
}
export interface AcpPlanCompletion extends AcpScheduledConfigKey {
  runId: string;
  projectId: string;
  status: "started" | "failed";
  taskId: string | null;
  error: string | null;
}
export interface AcpPlanResourceKey extends AcpPlanResourceScope {
  token: string;
}
export interface AcpPlanResource {
  token: string;
  attachment: AgentMessageAttachment;
  digest: string | null;
  written: number;
  boundRevision: number | null;
}
export interface CatalogOperations {
  "acp.plan.completion.read": [AcpScheduledConfigKey & { runId: string }, AcpPlanCompletion | null];
  "acp.plan.completion.put": [AcpPlanCompletion, AcpPlanCompletion | null];
  "acp.resource.begin": [
    AcpPlanResourceKey & { attachment: AgentMessageAttachment },
    AcpPlanResource,
  ];
  "acp.resource.append": [AcpPlanResourceKey & { offset: number; content: Uint8Array }, number];
  "acp.resource.seal": [AcpPlanResourceKey, AcpPlanResource];
  "acp.resource.chunk": [AcpPlanResourceKey & { offset: number }, Uint8Array | null];
  "acp.resource.abort": [AcpPlanResourceKey, boolean];
  "acp.resource.list": [AcpPlanResourceScope & { expectedRevision: number }, AcpPlanResource[]];
  "acp.plan.save": [
    AcpScheduledConfigKey & {
      definition: AcpScheduledPlanDefinition;
      expectedRevision: number;
      resources: readonly string[];
    },
    AcpScheduledPlan | null,
  ];
  "acp.plan.list": [
    { source: "web" | "desktop"; after?: string; limit: number },
    { data: AcpPlanMetadata[]; nextCursor: string | null },
  ];
  "acp.plan.due": [
    { after?: AcpPlanDueCursor; source: "web" | "desktop"; now: number; limit: number },
    AcpPlanMetadata[],
  ];
  "acp.plan.readState": [AcpScheduledConfigKey, AcpPlanState | null];
  "acp.plan.arm": [
    AcpScheduledConfigKey & {
      expectedRevision: number;
      expectedStateRevision: number;
      nextRunAt: number | null;
    },
    AcpPlanState | null,
  ];
  "acp.plan.claim": [
    AcpScheduledConfigKey & {
      expectedRevision: number;
      expectedStateRevision: number;
      nextRunAt: number | null;
      now: number;
      runId: string;
    },
    AcpPlanRun | null,
  ];
  "acp.plan.readRun": [AcpScheduledConfigKey & { runId: string }, AcpPlanRun | null];
  "acp.plan.finish": [
    AcpScheduledConfigKey & {
      runId: string;
      expectedStatus: "claimed" | "unknown";
      status: "unknown" | "started" | "failed";
      taskId: string | null;
      error: string | null;
    },
    AcpPlanRun | null,
  ];
  "acp.plan.read": [AcpScheduledConfigKey, AcpScheduledPlan | null];
  "acp.plan.set": [
    AcpScheduledConfigKey & { definition: AcpScheduledPlanDefinition; expectedRevision: number },
    AcpScheduledPlan | null,
  ];
  "acp.plan.delete": [AcpScheduledConfigKey & { expectedRevision: number }, boolean];
  "acp.schedule.read": [AcpScheduledConfigKey, AcpScheduledConfig | null];
  "acp.schedule.set": [
    AcpScheduledConfigKey & {
      engine: AgentEngine;
      values: AcpConfigValues;
      expectedRevision: number;
    },
    AcpScheduledConfig | null,
  ];
  "acp.schedule.delete": [AcpScheduledConfigKey & { expectedRevision: number }, boolean];
  "prompts.sync": [SavedPromptsRequest, SharedSavedPrompt[]];
  "project.list": [undefined, LocalProject[]];
  "project.put": [LocalProject, LocalProject];
  "project.read": [{ id: string }, LocalProject | null];
  "project.rename": [{ id: string; name: string }, LocalProject];
  "project.remove": [{ id: string }, boolean];
  "project.reorder": [{ ids: readonly string[] }, LocalProject[]];
  "task.put": [LocalTask, LocalTask];
  "task.read": [{ id: string }, LocalTask | null];
  "task.preview": [{ id: string; preview: string }, LocalTask];
  "task.recoverPreviews": [{ databasePath: string }, number];
  "task.bindings": [undefined, LocalTask[]];
  "task.patch": [
    Partial<Omit<LocalTask, "provider" | "projectId" | "preview">> & { id: string },
    LocalTask,
  ];
  "task.remove": [{ id: string }, boolean];
  "task.list": [LocalTaskQuery, { data: LocalTask[]; nextCursor: string | null }];
  "migration.done": [undefined, boolean];
  "migration.import": [
    { projects: (LocalProject & { sourceId?: string })[]; tasks: LocalTask[] },
    undefined,
  ];
}

export interface LocalCatalogStore {
  catalog<K extends keyof CatalogOperations>(
    operation: K,
    payload: CatalogOperations[K][0],
  ): Promise<CatalogOperations[K][1]>;
}
