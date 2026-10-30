import { Compartment, EditorState, type Extension, type Text } from "@codemirror/state";
import { history } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import type {
  ProjectTextFile,
  SaveProjectTextFileRequest,
  SaveProjectTextFileResponse,
} from "@codexly/frontend-core/text-file-editor";
import {
  createTextEditorState,
  getTextEditorByteLength,
  getTextEditorTransactionBytes,
  MAX_TEXT_EDITOR_BYTES,
  MAX_TEXT_EDITOR_PARSE_BYTES,
  TextEditorSession,
} from "./text-editor-state.js";
import { textEditorCapacity } from "./text-editor-capacity.js";

export type TextEditorSaveResult = "saved" | "error" | "conflict" | "input-limit";
export class TextEditorAutosave {
  state: EditorState;
  private snapshot: TextEditorSession;
  private pending: Promise<boolean> | null = null;
  private listeners = new Set<() => void>();
  private inputRejected = false;
  conflictSequence = 0;
  private saveFailure: "error" | "conflict" | null = null;
  readonly file: Pick<ProjectTextFile, "path">;
  revision: string | undefined;
  scrollSnapshot: ReturnType<EditorView["scrollSnapshot"]> | undefined;
  navigationLine: number | null | undefined;
  readonly language = new Compartment();
  languageLoaded = false;
  private languageExtension: Extension = [];
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
    this.revision = file.revision;
    this.save = save;
    this.onSaved = onSaved;
    this.notify = notify;
    this.state = this.createState(file.content);
    this.snapshot = new TextEditorSession(this.state.doc, file.version);
  }
  private createState(content: string | Text, lineBreak?: string): EditorState {
    return createTextEditorState(
      content,
      [
        history({ minDepth: 30 }),
        this.language.of([]),
        this.bindings.of([]),
        EditorState.transactionExtender.of((transaction) => {
          if (!transaction.docChanged) return null;
          const enabled = getTextEditorTransactionBytes(transaction) <= MAX_TEXT_EDITOR_PARSE_BYTES;
          const wasEnabled =
            getTextEditorByteLength(transaction.startState) <= MAX_TEXT_EDITOR_PARSE_BYTES;
          // 与正文事务一起重配，超阈值的文本不会先交给旧解析器；缩小后复用已加载的语言。
          return enabled === wasEnabled
            ? null
            : {
                effects: this.language.reconfigure(enabled ? this.languageExtension : []),
              };
        }),
      ],
      () => {
        this.inputRejected = true;
        this.notify("input-limit");
      },
      lineBreak,
    );
  }
  get byteLength(): number {
    return getTextEditorByteLength(this.state);
  }
  installLanguage(extension: Extension) {
    this.languageExtension = extension;
    this.languageLoaded = true;
    // 异步加载完成时再次核对最新正文，不能用发起加载时的大小决定解析开关。
    return this.language.reconfigure(
      this.byteLength <= MAX_TEXT_EDITOR_PARSE_BYTES ? extension : [],
    );
  }
  compactDraft(): void {
    // 闲置未保存文件只保留正文、选择和版本快照；历史/解析器不应随失败草稿累积。
    const selection = this.state.selection;
    this.languageExtension = [];
    this.languageLoaded = false;
    this.historyBytes = 0;
    this.state = this.createState(this.state.doc, this.state.lineBreak).update({ selection }).state;
  }
  get dirty(): boolean {
    return this.snapshot.isDirty(this.state.doc);
  }
  get saving(): boolean {
    return this.pending !== null;
  }
  get feedback(): "input-limit" | "error" | "conflict" | null {
    return this.inputRejected
      ? "input-limit"
      : this.saveFailure && this.dirty
        ? this.saveFailure
        : null;
  }
  dismissInputLimit(): void {
    this.inputRejected = false;
    this.emit();
  }
  discardChanges(): boolean {
    if (this.pending) return false;
    // 仅由明确确认的放弃动作调用；恢复最后一次成功保存的文本，清空撤销以免草稿复活。
    this.languageExtension = [];
    this.languageLoaded = false;
    this.historyBytes = 0;
    this.state = this.createState(this.snapshot.savedDocument, this.state.lineBreak);
    this.scrollSnapshot = undefined;
    // 冲突时磁盘可能已更新，下次打开必须重新校验，不能把恢复快照当成最新磁盘内容。
    this.revision = undefined;
    this.inputRejected = false;
    this.saveFailure = null;
    this.emit();
    return true;
  }
  useDiskVersion(file: ProjectTextFile, compared: Text): boolean {
    if (this.pending || this.state.doc !== compared || file.path !== this.file.path) return false;
    // 只接受用户确认且仍对应当前草稿的快照；重新建树清除撤销，不能撤销复活已放弃内容。
    this.languageExtension = [];
    this.languageLoaded = false;
    this.historyBytes = 0;
    this.state = this.createState(file.content);
    this.snapshot = new TextEditorSession(this.state.doc, file.version);
    this.revision = file.revision;
    this.scrollSnapshot = undefined;
    this.inputRejected = false;
    this.saveFailure = null;
    this.emit();
    this.onSaved();
    return true;
  }
  saveComparedDraft(file: ProjectTextFile, compared: Text): Promise<boolean> {
    if (this.pending || this.state.doc !== compared || file.path !== this.file.path)
      return Promise.resolve(false);
    // 比较只授权替换该磁盘版本，绝不跳过服务端条件校验；失败不能提前推进保存基线。
    return this.startSave(file.version);
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
    // 超限提示只在用户确认或下一次有效正文修改后解除；保存失败仍保留，直到成功保存。
    if (state.doc !== this.state.doc) this.inputRejected = false;
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
    return this.startSave(this.snapshot.version);
  }
  private startSave(expectedVersion: string): Promise<boolean> {
    // 同一文件只允许一次在途显式保存；重复按钮/快捷键共享当前回执。
    this.pending = this.drain(expectedVersion).finally(() => {
      this.pending = null;
      this.emit();
    });
    this.emit();
    return this.pending;
  }
  private async drain(expectedVersion: string): Promise<boolean> {
    try {
      const submitted = this.state.doc;
      const content = this.state.sliceDoc();
      if (new TextEncoder().encode(content).byteLength > MAX_TEXT_EDITOR_BYTES)
        throw new Error("File too large");
      const result = await this.save({
        path: this.file.path,
        content,
        expectedVersion,
      });
      this.snapshot.markSaved(submitted, result.version);
      this.revision = result.revision;
      // 仅确认提交瞬间的快照；等待期间的新输入仍为草稿，必须由下一次显式保存提交。
    } catch (error) {
      const conflict =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "TEXT_FILE_CONFLICT";
      this.saveFailure = conflict ? "conflict" : "error";
      if (conflict) this.conflictSequence++;
      this.notify(this.saveFailure);
      return false;
    }
    this.onSaved();
    this.saveFailure = null;
    if (!this.dirty) this.notify("saved");
    return !this.dirty;
  }
}

// 草稿集合负责退出保护和失败恢复；保存后移除，闲置会话由有界缓存管理。
const drafts = new Map<object, Map<string, TextEditorAutosave>>();
const retainedDrafts = new WeakSet<TextEditorAutosave>();
const capacityLeases = new WeakMap<
  TextEditorAutosave,
  { release: () => void; active: () => boolean }
>();
export function getTextEditorSessionCapacity(
  session: TextEditorAutosave,
): (() => void) | undefined {
  return capacityLeases.get(session)?.release;
}
export function reserveTextEditorSession(
  session: TextEditorAutosave,
  release: () => void,
  active: () => boolean,
): void {
  capacityLeases.set(session, { release, active });
}
export function releaseTextEditorSession(session: TextEditorAutosave): void {
  capacityLeases.get(session)?.release();
  capacityLeases.delete(session);
}
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
  if (retainedDrafts.has(session)) return;
  // 独立调用的保留路径也必须占用预算；缓存路径已在读取之前预留，不能重复计数。
  if (!capacityLeases.has(session))
    reserveTextEditorSession(session, textEditorCapacity.reserve(), () => false);
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
    if (!capacityLeases.get(session)?.active()) releaseTextEditorSession(session);
    retainedDrafts.delete(session);
    if (!entries.size) drafts.delete(scope);
    if (!drafts.size && typeof window !== "undefined")
      window.removeEventListener("beforeunload", protectDrafts);
    unlisten();
  });
}
