import type { EditorState } from "@codemirror/state";
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
  readonly file: ProjectTextFile;
  private save: (input: SaveProjectTextFileRequest) => Promise<SaveProjectTextFileResponse>;
  private onSaved: () => void;
  private notify: (result: TextEditorSaveResult) => void;
  constructor(
    file: ProjectTextFile,
    save: (input: SaveProjectTextFileRequest) => Promise<SaveProjectTextFileResponse>,
    onSaved: () => void,
    notify: (result: TextEditorSaveResult) => void,
  ) {
    this.file = file;
    this.save = save;
    this.onSaved = onSaved;
    this.notify = notify;
    this.state = createTextEditorState(file.content);
    this.snapshot = new TextEditorSession(this.state.doc, file.version);
  }
  get dirty(): boolean {
    return this.snapshot.isDirty(this.state.doc);
  }
  get saving(): boolean {
    return this.pending !== null;
  }
  update(state: EditorState): void {
    this.state = state;
    this.emit();
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

// 仅保留离开时尚未保存的会话；成功后立即释放，避免缓存所有打开过的文件。
const drafts = new Map<object, Map<string, TextEditorAutosave>>();
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
  if (!drafts.size && typeof window !== "undefined")
    window.addEventListener("beforeunload", protectDrafts);
  const entries = drafts.get(scope) ?? new Map<string, TextEditorAutosave>();
  entries.set(key, session);
  drafts.set(scope, entries);
  const unlisten = session.subscribe(() => {
    if (entries.get(key) !== session) {
      unlisten();
      return;
    }
    if (session.dirty || session.saving) return;
    entries.delete(key);
    if (!entries.size) drafts.delete(scope);
    if (!drafts.size && typeof window !== "undefined")
      window.removeEventListener("beforeunload", protectDrafts);
    unlisten();
  });
  void session.flush();
}
