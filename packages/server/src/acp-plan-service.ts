import { Value } from "@sinclair/typebox/value";
import type { AcpAgentSettingsService, AcpPlanView, LocalCatalogStore } from "@codexly/core";
import type { AgentEngine, ScheduledTaskSchedule } from "@codexly/protocol";
import { SaveAcpPlanSchema } from "@codexly/protocol/acp-plan-api";
import type { ProjectContextResolver } from "./routes/context.js";
import type { AcpPlanResourceManager } from "./acp-plan-resource-transfer.js";
import { previewScheduledTask } from "./scheduled-task-recurrence.js";

export class AcpPlanServiceError extends Error {
  constructor(
    public readonly code: "invalid" | "conflict" | "busy" | "unavailable",
    message: string,
  ) {
    super(message);
  }
}
interface Ports {
  catalog: LocalCatalogStore;
  getProjectContext: ProjectContextResolver;
  agents: Partial<Record<AgentEngine, Pick<AcpAgentSettingsService, "previewConfig">>>;
  resources?: Pick<AcpPlanResourceManager, "stage">;
  wake?: () => void;
  now?: () => number;
}
function fail(code: AcpPlanServiceError["code"], message: string): never {
  throw new AcpPlanServiceError(code, message);
}
const sameValues = (a: Record<string, string | boolean>, b: Record<string, string | boolean>) =>
  Object.keys(a).length === Object.keys(b).length &&
  Object.entries(a).every(([id, value]) => Object.hasOwn(b, id) && b[id] === value);

function sameSchedule(a: ScheduledTaskSchedule, b: ScheduledTaskSchedule): boolean {
  if (a.type === "once") return b.type === "once" && a.atUnixMs === b.atUnixMs;
  return (
    b.type === "rrule" &&
    a.startAtUnixMs === b.startAtUnixMs &&
    a.rrule === b.rrule &&
    a.timezone === b.timezone
  );
}

/** 新计划的应用入口；预览和日历计算全部在数据库事务之外，最终用双修订原子提交。 */
export class AcpPlanService {
  constructor(private readonly ports: Ports) {}
  private key(scheduleId: string) {
    if (!scheduleId.length || scheduleId.length > 256) fail("invalid", "Invalid ACP plan identity");
    return { source: "web" as const, scheduleId };
  }
  read(id: string): Promise<AcpPlanView | null> {
    return this.ports.catalog.catalog("acp.plan.view", this.key(id));
  }
  private async project(projectId: string) {
    const context = await this.ports.getProjectContext(projectId);
    if (
      !context?.provider.startConfiguredTurn ||
      (await context.provider.getCapabilities()).runtime !== "acp"
    )
      fail("unavailable", "ACP project runtime is unavailable");
    return context;
  }
  private wake() {
    // 提交已经持久化；唤醒只是低延迟提示，失败由启动恢复和调度器兜底，不能诱导重复保存。
    try {
      this.ports.wake?.();
    } catch {
      /* 保留已成功提交的结果。 */
    }
  }
  async save(id: string, input: unknown, signal?: AbortSignal): Promise<AcpPlanView> {
    const key = this.key(id);
    signal?.throwIfAborted();
    if (
      !Value.Check(SaveAcpPlanSchema, input) ||
      Buffer.byteLength(JSON.stringify(input)) > 1048576
    )
      fail("invalid", "Invalid ACP plan request");
    const { definition, resources, expectedRevision, expectedStateRevision } = Value.Clone(input);
    if (!definition.name.trim()) fail("invalid", "ACP plan name is empty");
    const before = await this.read(id);
    if (
      (before?.revision ?? 0) !== expectedRevision ||
      (before?.state?.revision ?? 0) !== expectedStateRevision ||
      (before && before.definition.projectId !== definition.projectId)
    )
      fail("conflict", "ACP plan changed; reload before saving");
    if (before?.canEdit === false) fail("busy", "Previous ACP launch requires reconciliation");
    const rootPath = (await this.project(definition.projectId)).scope.rootPath;
    if (definition.enabled) {
      if (
        (!definition.prompt.text.trim() && !definition.prompt.attachments.length) ||
        definition.prompt.skills.length
      )
        fail("invalid", "Persistent ACP plan input is unavailable");
      if (
        !before?.definition.enabled ||
        before.definition.engine !== definition.engine ||
        !sameValues(before.definition.values, definition.values)
      ) {
        const agent = this.ports.agents[definition.engine];
        if (!agent?.previewConfig) fail("unavailable", "ACP configuration preview is unavailable");
        signal?.throwIfAborted();
        const checked = await agent.previewConfig(rootPath, { values: definition.values }, signal);
        if (
          !Object.entries(definition.values).every(([id, value]) =>
            checked.configOptions.some(
              (option) => option.id === id && option.currentValue === value,
            ),
          )
        )
          fail("invalid", "ACP agent did not accept the selected configuration");
      }
    }
    let nextRunAt: number | null = null;
    if (definition.enabled) {
      if (
        before?.definition.enabled &&
        before.state?.definitionRevision === before.revision &&
        sameSchedule(before.definition.schedule, definition.schedule)
      )
        nextRunAt = before.state.nextRunAt;
      else {
        const now = (this.ports.now ?? Date.now)();
        if (definition.schedule.type === "once" && definition.schedule.atUnixMs <= now)
          fail("invalid", "ACP plan time must be in the future");
        nextRunAt = (await previewScheduledTask(definition.schedule, now, 1))[0] ?? null;
      }
    }
    const currentProject = await this.project(definition.projectId);
    if (currentProject.scope.rootPath !== rootPath)
      fail("conflict", "ACP project root changed during validation");
    signal?.throwIfAborted();
    const saved = await this.ports.catalog.catalog("acp.plan.commit", {
      ...key,
      definition,
      resources,
      expectedRevision,
      expectedStateRevision,
      nextRunAt,
    });
    if (!saved) fail("conflict", "ACP plan changed during validation");
    this.wake();
    return saved;
  }
  async delete(id: string, expectedRevision: number) {
    const deleted = await this.ports.catalog.catalog("acp.plan.delete", {
      ...this.key(id),
      expectedRevision,
    });
    if (deleted) this.wake();
    return deleted;
  }
  async stage(id: string, projectId: string, uploadId: string, signal?: AbortSignal) {
    const key = this.key(id),
      before = await this.read(id);
    if (before && before.definition.projectId !== projectId)
      fail("conflict", "ACP plan project changed");
    if (before?.canEdit === false) fail("busy", "Previous ACP launch requires reconciliation");
    await this.project(projectId);
    if (!this.ports.resources) fail("unavailable", "ACP plan resources are unavailable");
    return this.ports.resources.stage({ ...key, projectId }, uploadId, signal);
  }
}
