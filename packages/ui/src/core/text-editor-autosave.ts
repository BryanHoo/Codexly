import { Compartment, type EditorState, type Extension } from "@codemirror/state";
import { history } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import type {
  ProjectTextFile,
  SaveProjectTextFileRequest,
  SaveProjectTextFileResponse,
} from "@codexly/frontend-core/text-file-editor";
import { createTextEditorState, TextEditorSession } from "./text-editor-state.js";

export type TextEditorSaveResult = "saved" | "error" | "conflict";
export class TextEditorAutosave {
  state: EditorState;
  private snapshot: TextEditorSession;
  private pending: Promise<boolean> | null = null;
  private listeners = new Set<() => void>();
  readonly file: Pick<ProjectTextFile, "path">;
  readonly byteLength: number;
  revision: string | undefined;
  scrollSnapshot: ReturnType<EditorView["scrollSnapshot"]> | undefined;
  navigationLine: number | null | undefined;
  readonly language = new Compartment();
  languageLoaded = false;
  private bindings = new Compartment();
  private historyBytes = 0;
  private save: (input: SaveProjectTextFileRequest) => Promise<SaveProjectTextFileResponse>;
  private onSaved: () => void;
  private notify: (result: TextEditorSaveResult) => void;
  constructor(
    file: ProjectTextFile,
    save: (input: SaveProjectTextFileRequest) => Promise<SaveProjectTextFileResponse>,
    onSaved: () => void,
    notify: (result: TextEditorSaveResult) => void,
  ) {
    // 原始字符串在建树后即可释放，缓存只保留文件身份和持久化文本状态。
    this.file = { path: file.path };
    this.byteLength = new TextEncoder().encode(file.content).byteLength;
    this.revision = file.revision;
    this.save = save;
    this.onSaved = onSaved;
    this.notify = notify;
    this.state = createTextEditorState(file.content, [
      history({ minDepth: 30 }),
      this.language.of([]),
      this.bindings.of([]),
    ]);
    this.snapshot = new TextEditorSession(this.state.doc, file.version);
  }
  get dirty(): boolean {
    return this.snapshot.isDirty(this.state.doc);
  }
  get saving(): boolean {
    return this.pending !== null;
  }
  get version(): string {
    return this.snapshot.version;
  }
  get retainedBytes(): number {
    // 保守估计文本树、保存快照、历史与解析状态；它是缓存预算单位，不是精确堆测量。
    return 64 * 1024 + this.state.doc.length * 8 + this.historyBytes;
  }
  bindView(extensions: Extension): EditorState {
    // 仅替换视图回调，不重建文档、选择或撤销历史；卸载后清除闭包以释放 DOM 引用。
    this.state = this.state.update({ effects: this.bindings.reconfigure(extensions) }).state;
    return this.state;
  }
  update(state: EditorState, changedBytes = 0): void {
    this.historyBytes += changedBytes;
    this.state = state;
    this.emit();
  }
  setCallbacks(
    save: TextEditorAutosave["save"],
    onSaved: () => void,
    notify: TextEditorAutosave["notify"],
  ): void {
    this.save = save;
    this.onSaved = onSaved;
    this.notify = notify;
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private emit(): void {
    for (const listener of this.listeners) listener();
  }
  flush(): Promise<boolean> {
    if (this.pending) return this.pending;
    if (!this.dirty) return Promise.resolve(true);
    // 同一文件只允许一个保存链；失焦、快捷键和离开动作共享该 Promise。
    this.pending = this.drain().finally(() => {
      this.pending = null;
      this.emit();
    });
    this.emit();
    return this.pending;
  }
  private async drain(): Promise<boolean> {
    try {
      do {
        const submitted = this.state.doc;
        const content = this.state.sliceDoc();
        if (new TextEncoder().encode(content).byteLength > 2 * 1024 * 1024)
          throw new Error("File too large");
        const result = await this.save({
          path: this.file.path,
          content,
          expectedVersion: this.snapshot.version,
        });
        this.snapshot.markSaved(submitted, result.version);
        this.revision = result.revision;
        // 等待期间有新输入时使用新版本串行补存，不能把旧快照误报为全部保存。
      } while (this.dirty);
    } catch (error) {
      const conflict =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "TEXT_FILE_CONFLICT";
      this.notify(conflict ? "conflict" : "error");
      return false;
    }
    this.onSaved();
    this.notify("saved");
    return true;
  }
}

// 草稿集合负责退出保护和失败恢复；保存后移除，闲置会话由有界缓存管理。
const drafts = new Map<object, Map<string, TextEditorAutosave>>();
const retainedDrafts = new WeakSet<TextEditorAutosave>();
const protectDrafts = (event: BeforeUnloadEvent) => {
  event.preventDefault();
};
export function getTextEditorDraft(scope: object, key: string): TextEditorAutosave | undefined {
  return drafts.get(scope)?.get(key);
}
export function retainTextEditorDraft(
  scope: object,
  key: string,
  session: TextEditorAutosave,
): void {
  if (!session.dirty && !session.saving) return;
  if (retainedDrafts.has(session)) {
    void session.flush();
    return;
  }
  retainedDrafts.add(session);
  if (!drafts.size && typeof window !== "undefined")
    window.addEventListener("beforeunload", protectDrafts);
  const entries = drafts.get(scope) ?? new Map<string, TextEditorAutosave>();
  entries.set(key, session);
  drafts.set(scope, entries);
  const unlisten = session.subscribe(() => {
    if (entries.get(key) !== session) {
      retainedDrafts.delete(session);
      unlisten();
      return;
    }
    if (session.dirty || session.saving) return;
    entries.delete(key);
    retainedDrafts.delete(session);
    if (!entries.size) drafts.delete(scope);
    if (!drafts.size && typeof window !== "undefined")
      window.removeEventListener("beforeunload", protectDrafts);
    unlisten();
  });
  void session.flush();
}
