import type { AgentMessageAttachment } from "@codexly/protocol";
import type { AcpScheduledPlanDefinition } from "@codexly/protocol/acp-scheduled-plan";
import type { AcpPlanView, SaveAcpPlan } from "@codexly/protocol/acp-plan-api";
type Resource = AcpPlanView["resources"][number];
interface Options {
  signal: AbortSignal;
  idempotencyKey: string;
}
export interface AcpPlanEditorPorts {
  saveAcpPlan(id: string, input: SaveAcpPlan, options: Options): Promise<AcpPlanView>;
  stageAcpPlanAttachment(
    id: string,
    projectId: string,
    attachment: AgentMessageAttachment,
    options: Options,
  ): Promise<Resource>;
}
export interface AcpPlanEditorSnapshot {
  readonly definition: AcpScheduledPlanDefinition;
  readonly view: AcpPlanView | null;
  readonly resources: readonly Resource[];
  readonly busy: boolean;
  readonly dirty: boolean;
  readonly closed: boolean;
}
const copy = <T>(value: T): T => structuredClone(value);
/** 两端共用编辑事务；草稿和请求身份仅驻留当前编辑器，不改旧偏好或任务 JSON。 */
export class AcpPlanEditorSession {
  #state: AcpPlanEditorSnapshot;
  #request: { kind: "save" | "stage"; fingerprint: string; key: string } | undefined;
  #active: AbortController | undefined;
  readonly id: string;
  private readonly ports: AcpPlanEditorPorts;
  private readonly makeKey: () => string;
  constructor(
    id: string,
    definition: AcpScheduledPlanDefinition,
    ports: AcpPlanEditorPorts,
    makeKey: () => string = () => crypto.randomUUID(),
  ) {
    this.id = id;
    this.ports = ports;
    this.makeKey = makeKey;
    if (!id || id.length > 256 || definition.prompt.attachments.length)
      throw new TypeError("New ACP plan requires an empty private resource set");
    this.#state = {
      definition: copy(definition),
      view: null,
      resources: [],
      busy: false,
      dirty: true,
      closed: false,
    };
  }
  static edit(view: AcpPlanView, ports: AcpPlanEditorPorts, makeKey?: () => string) {
    const definition = copy(view.definition);
    definition.prompt.attachments = [];
    const session = new AcpPlanEditorSession(view.scheduleId, definition, ports, makeKey);
    session.load(view);
    return session;
  }
  get snapshot(): AcpPlanEditorSnapshot {
    return copy(this.#state);
  }
  #editable() {
    if (this.#state.closed || this.#state.busy || this.#state.view?.canEdit === false)
      throw new Error("ACP plan editor is unavailable");
  }
  update(definition: AcpScheduledPlanDefinition) {
    this.#editable();
    if (
      (this.#state.view || this.#state.resources.length) &&
      definition.projectId !== this.#state.definition.projectId
    )
      throw new Error("ACP plan project is immutable");
    const refs = definition.prompt.attachments;
    const resourceIds = new Set(this.#state.resources.map((r) => r.attachment.id));
    if (refs.length !== this.#state.resources.length || refs.some((r) => !resourceIds.delete(r.id)))
      throw new Error("ACP plan resource references changed");
    this.#state = { ...this.#state, definition: copy(definition), dirty: true };
  }
  /** 只有明确重新读取才替换编辑内容，普通后台刷新不能调用此入口。 */
  load(view: AcpPlanView) {
    if (this.#state.closed || this.#state.busy) throw new Error("ACP plan editor is unavailable");
    if (view.scheduleId !== this.id) throw new Error("ACP plan identity changed");
    this.#checkResources(view.definition, view.resources);
    this.#state = {
      ...this.#state,
      definition: copy(view.definition),
      resources: copy(view.resources),
      view: copy(view),
      dirty: false,
    };
    this.#request = undefined;
  }
  #checkResources(definition: AcpScheduledPlanDefinition, resources: readonly Resource[]) {
    const ids = new Set(definition.prompt.attachments.map((r) => r.id));
    if (
      ids.size !== resources.length ||
      resources.some((r) => !r.digest || !ids.delete(r.attachment.id)) ||
      ids.size
    )
      throw new Error("Incomplete ACP plan resources");
  }
  #begin(kind: "save" | "stage", input: unknown) {
    this.#editable();
    const fingerprint = JSON.stringify(input);
    if (this.#request?.kind !== kind || this.#request.fingerprint !== fingerprint)
      this.#request = { kind, fingerprint, key: this.makeKey() };
    const controller = new AbortController();
    this.#active = controller;
    this.#state = { ...this.#state, busy: true };
    return { signal: controller.signal, idempotencyKey: this.#request.key };
  }
  #end() {
    this.#active = undefined;
    this.#state = { ...this.#state, busy: false };
  }
  async save(): Promise<AcpPlanView | undefined> {
    const input: SaveAcpPlan = {
      definition: copy(this.#state.definition),
      resources: this.#state.resources.map((r) => r.token),
      expectedRevision: this.#state.view?.revision ?? 0,
      expectedStateRevision: this.#state.view?.state?.revision ?? 0,
    };
    const options = this.#begin("save", input);
    try {
      const view = await this.ports.saveAcpPlan(this.id, input, options);
      if (this.#state.closed) return undefined;
      if (
        view.scheduleId !== this.id ||
        view.definition.projectId !== input.definition.projectId ||
        view.revision <= input.expectedRevision ||
        view.state?.definitionRevision !== view.revision
      )
        throw new Error("Unexpected ACP plan revision");
      this.#checkResources(view.definition, view.resources);
      this.#state = {
        ...this.#state,
        view: copy(view),
        definition: copy(view.definition),
        resources: copy(view.resources),
        dirty: false,
      };
      this.#request = undefined;
      return copy(view);
    } catch (error) {
      if (this.#state.closed) return;
      throw error;
    } finally {
      this.#end();
    }
  }
  async stage(attachment: AgentMessageAttachment): Promise<void> {
    const input = { projectId: this.#state.definition.projectId, attachment: copy(attachment) };
    const options = this.#begin("stage", input);
    try {
      const resource = await this.ports.stageAcpPlanAttachment(
        this.id,
        input.projectId,
        input.attachment,
        options,
      );
      if (this.#state.closed) return;
      if (
        !resource.digest ||
        resource.boundRevision !== null ||
        this.#state.resources.some(
          (r) => r.token === resource.token || r.attachment.id === resource.attachment.id,
        )
      )
        throw new Error("Unexpected ACP staged resource");
      const definition = copy(this.#state.definition);
      definition.prompt.attachments.push({ id: resource.attachment.id });
      this.#state = {
        ...this.#state,
        definition,
        resources: [...this.#state.resources, copy(resource)],
        dirty: true,
      };
      this.#request = undefined;
    } catch (error) {
      if (this.#state.closed) return;
      throw error;
    } finally {
      this.#end();
    }
  }
  removeAttachment(id: string) {
    this.#editable();
    const definition = copy(this.#state.definition);
    definition.prompt.attachments = definition.prompt.attachments.filter((r) => r.id !== id);
    this.#state = {
      ...this.#state,
      definition,
      resources: this.#state.resources.filter((r) => r.attachment.id !== id),
      dirty: true,
    };
  }
  close() {
    this.#active?.abort();
    this.#state = { ...this.#state, closed: true };
  }
}
