import type { ProjectTextFile } from "@codexly/frontend-core/text-file-editor";
import {
  getTextEditorDraft,
  getTextEditorSessionCapacity,
  retainTextEditorDraft,
  reserveTextEditorSession,
  releaseTextEditorSession,
  TextEditorAutosave,
  type TextEditorSaveResult,
} from "./text-editor-autosave.js";
import { textEditorCapacity, type TextEditorCapacity } from "./text-editor-capacity.js";

type Callbacks = Readonly<{
  read: (signal: AbortSignal) => Promise<ProjectTextFile>;
  checkRevision: (signal: AbortSignal) => Promise<{ revision: string }>;
  save: ConstructorParameters<typeof TextEditorAutosave>[1];
  onSaved: () => void;
  notify: (result: TextEditorSaveResult | "load-error") => void;
}>;
interface Entry {
  users: number;
  session?: TextEditorAutosave | undefined;
  pending?: Promise<TextEditorAutosave> | undefined;
  controller?: AbortController | undefined;
  unlisten?: (() => void) | undefined;
  releaseCapacity?: (() => void) | undefined;
}

export class TextEditorSessionCache {
  private entries = new Map<string, Entry>();
  private scope: object;
  private maxEntries: number;
  private maxBytes: number;
  private capacity: TextEditorCapacity;
  constructor(
    scope: object,
    maxEntries = 16,
    maxBytes = 64 * 1024 * 1024,
    capacity: TextEditorCapacity = textEditorCapacity,
  ) {
    this.scope = scope;
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
    this.capacity = capacity;
  }

  acquire(key: string, callbacks: Callbacks) {
    const entry = this.entries.get(key) ?? { users: 0 };
    const wasActive = entry.users > 0;
    entry.users++;
    this.entries.delete(key);
    this.entries.set(key, entry);
    if (!entry.pending) {
      entry.controller = new AbortController();
      const signal = entry.controller.signal;
      const draft = getTextEditorDraft(this.scope, key);
      const cached = draft ?? entry.session;
      // 已挂载或未保存的状态直接复用；草稿不能被外部磁盘版本覆盖。
      entry.pending = (async () => {
        // 读取前占位，在途请求、活动编辑和失败草稿共用同一份预留，容量满时回退只读。
        entry.releaseCapacity ??=
          (cached && getTextEditorSessionCapacity(cached)) ?? this.capacity.reserve();
        let session = cached;
        if (!session || (!wasActive && !session.dirty && !session.saving)) {
          const unchanged =
            session?.revision !== undefined &&
            (await callbacks.checkRevision(signal)).revision === session.revision;
          if (!unchanged) {
            const file = await callbacks.read(signal);
            signal.throwIfAborted();
            // 元数据变化但正文相同时保留撤销和选择，只更新修订标记。
            if (session?.version === file.version) session.revision = file.revision;
            else
              session = new TextEditorAutosave(
                file,
                callbacks.save,
                callbacks.onSaved,
                callbacks.notify,
              );
          }
        }
        if (!session) throw new Error("Missing text editor session");
        signal.throwIfAborted();
        session.setCallbacks(callbacks.save, callbacks.onSaved, callbacks.notify);
        reserveTextEditorSession(session, entry.releaseCapacity, () => entry.users > 0);
        entry.unlisten?.();
        entry.session = session;
        entry.unlisten = session.subscribe(() => {
          this.prune();
        });
        return session;
      })()
        .catch((error: unknown) => {
          // 版本检查失败时不展示旧的已保存文本，下一次打开允许重新尝试。
          entry.unlisten?.();
          entry.unlisten = undefined;
          entry.session = undefined;
          entry.releaseCapacity?.();
          entry.releaseCapacity = undefined;
          throw error;
        })
        .finally(() => {
          entry.pending = undefined;
          entry.controller = undefined;
          this.prune();
        });
    }
    const ready = entry.pending;
    let released = false;
    return {
      ready,
      release: () => {
        if (released) return;
        released = true;
        entry.users--;
        if (!entry.users && entry.session) {
          if (entry.session.dirty) entry.session.compactDraft();
          retainTextEditorDraft(this.scope, key, entry.session);
        }
        // 失焦不取消共享读取；原生读取无法撤回，短暂切走再回来仍等待同一结果。
        this.prune();
      },
    };
  }

  private prune(): void {
    let bytes = 0;
    for (const entry of this.entries.values()) {
      bytes += entry.session?.retainedBytes ?? 64 * 1024;
      if (!entry.users && !entry.pending && !entry.session?.dirty && !entry.session?.saving) {
        entry.releaseCapacity?.();
        entry.releaseCapacity = undefined;
        if (entry.session) releaseTextEditorSession(entry.session);
      }
    }
    for (const [key, entry] of this.entries) {
      if (this.entries.size <= this.maxEntries && bytes <= this.maxBytes) break;
      // 活动会话和未保存草稿不参与淘汰；预算只约束可丢弃的闲置缓存。
      if (entry.users || entry.pending || entry.session?.dirty || entry.session?.saving) continue;
      bytes -= entry.session?.retainedBytes ?? 64 * 1024;
      entry.controller?.abort();
      entry.unlisten?.();
      this.entries.delete(key);
    }
  }
}

// 客户端身份隔离项目/主机，WeakMap 避免窗口或客户端释放后残留已保存文本。
const caches = new WeakMap<object, TextEditorSessionCache>();
export function getTextEditorSessionCache(scope: object): TextEditorSessionCache {
  let cache = caches.get(scope);
  if (!cache) {
    cache = new TextEditorSessionCache(scope);
    caches.set(scope, cache);
  }
  return cache;
}
