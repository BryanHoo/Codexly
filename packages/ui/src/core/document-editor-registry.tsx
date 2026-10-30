export type DocumentEditorBinding = Readonly<{
  path: string;
  isDirty: () => boolean;
  isSaving: () => boolean;
  save: () => Promise<boolean>;
  discard: () => boolean;
  subscribe: (listener: () => void) => () => void;
}>;
export type DocumentCloseRequest = Readonly<{
  reason: "close" | "switch-project";
  token: number;
  entries: readonly Readonly<{ id: string; binding: DocumentEditorBinding }>[];
  busy: boolean;
}>;

/** 标签仅持有会话句柄，不复制正文。后台标签卸载编辑器后仍能显示脏状态并参与关闭保护。 */
export class DocumentEditorRegistry {
  private entries = new Map<
    string,
    {
      binding: DocumentEditorBinding;
      dirty: boolean;
      saving: boolean;
      attached: boolean;
      release: () => void;
    }
  >();
  private listeners = new Set<() => void>();
  private request: DocumentCloseRequest | null = null;
  private pending: Promise<boolean> | null = null;
  private settle: ((allowed: boolean) => void) | null = null;
  private sequence = 0;
  failedId: string | undefined;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getRequest = () => this.request;
  isDirty = (id: string) => {
    const entry = this.entries.get(id);
    return entry ? entry.dirty || entry.saving : false;
  };
  private emit() {
    for (const listener of this.listeners) listener();
  }
  register(id: string, binding: DocumentEditorBinding) {
    const previous = this.entries.get(id);
    if (previous?.binding === binding) {
      previous.attached = true;
      return;
    }
    previous?.release();
    const entry = {
      binding,
      dirty: binding.isDirty(),
      saving: binding.isSaving(),
      attached: true,
      release: () => {
        /* 订阅建立后立即替换。 */
      },
    };
    entry.release = binding.subscribe(() => {
      const dirty = binding.isDirty();
      const saving = binding.isSaving();
      // 普通输入和光标事务不发布标签更新；只在脏状态/保存状态跨边界时通知。
      if (entry.dirty === dirty && entry.saving === saving) return;
      entry.dirty = dirty;
      entry.saving = saving;
      if (!entry.attached && !dirty && !saving) {
        entry.release();
        this.entries.delete(id);
      }
      if (this.request) this.request = { ...this.request };
      this.emit();
    });
    this.entries.set(id, entry);
    this.emit();
  }
  detach(id: string, binding: DocumentEditorBinding) {
    const entry = this.entries.get(id);
    if (entry?.binding !== binding) return;
    entry.attached = false;
    // 干净后台标签只保留资源描述，不能用注册表绕过编辑缓存的 LRU/字节预算。
    if (!entry.dirty && !entry.saving) {
      entry.release();
      this.entries.delete(id);
    }
  }
  retainOnly(ids: readonly string[]) {
    const retained = new Set(ids);
    for (const [id, entry] of this.entries)
      if (!retained.has(id)) {
        entry.release();
        this.entries.delete(id);
      }
  }
  requestCloseAll(reason: DocumentCloseRequest["reason"] = "close") {
    return this.requestClose([...this.entries.keys()], reason);
  }
  requestClose(
    ids: readonly string[],
    reason: DocumentCloseRequest["reason"] = "close",
  ): boolean | Promise<boolean> {
    if (this.pending) return this.pending;
    this.failedId = undefined;
    const entries = [...new Set(ids)].flatMap((id) => {
      const binding = this.entries.get(id)?.binding;
      return binding && (binding.isDirty() || binding.isSaving()) ? [{ id, binding }] : [];
    });
    if (!entries.length) return true;
    this.request = { token: ++this.sequence, reason, entries, busy: false };
    this.pending = new Promise((resolve) => {
      this.settle = resolve;
    });
    this.emit();
    return this.pending;
  }
  cancelClose() {
    this.sequence++;
    this.finish(false);
  }
  private finish(allowed: boolean) {
    const resolve = this.settle;
    this.request = null;
    this.pending = null;
    this.settle = null;
    this.emit();
    resolve?.(allowed);
  }
  async resolveClose(choice: "save" | "discard" | "cancel") {
    const request = this.request;
    if (!request || request.busy) return;
    if (choice === "cancel") {
      this.cancelClose();
      return;
    }
    if (choice === "discard" && request.entries.some(({ binding }) => binding.isSaving())) return;
    this.request = { ...request, busy: true };
    this.emit();
    for (const { id, binding } of request.entries) {
      if (request.token !== this.sequence) return;
      let allowed = false;
      try {
        allowed = choice === "save" ? await binding.save() : binding.discard();
      } catch {
        /* 保存异常由会话提示，标签保持打开。 */
      }
      if (request.token !== this.sequence) return;
      if (!allowed || binding.isDirty() || binding.isSaving()) {
        this.failedId = id;
        this.finish(false);
        return;
      }
    }
    this.finish(true);
  }
  dispose() {
    this.cancelClose();
    for (const entry of this.entries.values()) entry.release();
    this.entries.clear();
  }
}
