import { useEffect, useRef, useState } from "react";
import type {
  ProjectTextFile,
  SaveProjectTextFileRequest,
  SaveProjectTextFileResponse,
} from "@codexly/frontend-core/text-file-editor";
import type { TextEditorAutosave, TextEditorSaveResult } from "./text-editor-autosave.js";

import type * as TextEditorModule from "./text-file-editor.js";
type EditorModule = typeof TextEditorModule;
export type InlineTextFileOptions = Readonly<{
  enabled: boolean;
  fileKey: string;
  scope: object;
  lineNumber?: number | null;
  read: (signal: AbortSignal) => Promise<ProjectTextFile>;
  save: (input: SaveProjectTextFileRequest) => Promise<SaveProjectTextFileResponse>;
  onSaved: () => void;
  notify: (result: TextEditorSaveResult | "load-error") => void;
  registerCloseGuard?: (requestClose: (close: () => void) => void) => Promise<() => void>;
}>;

export function useInlineTextFile(options: InlineTextFileOptions) {
  const { enabled, fileKey, scope, lineNumber, registerCloseGuard } = options;
  const callbacks = useRef(options);
  callbacks.current = options;
  const active = useRef<TextEditorAutosave | null>(null);
  const [loaded, setLoaded] = useState<{
    fileKey: string;
    session: TextEditorAutosave;
    module: EditorModule;
  } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    // 回调绑定本次文件身份，迟到的保存不能写入刚切换到的另一个文件。
    const current = callbacks.current;
    let session: TextEditorAutosave | undefined;
    let module: EditorModule | undefined;
    setLoaded(null);
    // 完整读取与编辑器模块并行；读取结果先收敛，恢复失败草稿时不会产生未处理拒绝。
    const reading = current.read(controller.signal).then(
      (file) => ({ file, error: null }),
      (error: unknown) => ({ file: null, error }),
    );
    void import("./text-file-editor.js")
      .then(async (editor) => {
        module = editor;
        const draft = editor.getTextEditorDraft(scope, fileKey);
        if (draft) return draft;
        const result = await reading;
        if (!result.file) throw result.error;
        const file = result.file;
        return new editor.TextEditorAutosave(file, current.save, current.onSaved, current.notify);
      })
      .then((value) => {
        if (controller.signal.aborted || !module) return;
        session = value;
        active.current = value;
        setLoaded({ fileKey, session: value, module });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        // 不可编辑的文件继续原有只读预览；网络等异常才提示，避免每次预览都弹错误。
        const code =
          typeof error === "object" && error !== null && "code" in error ? error.code : null;
        if (code !== "TEXT_FILE_UNSUPPORTED") current.notify("load-error");
      });
    return () => {
      controller.abort();
      active.current = null;
      // 文件切换可能直接卸载正文，仍须补存；失败草稿保留到再次打开该文件。
      if (session && module) module.retainTextEditorDraft(scope, fileKey, session);
    };
  }, [enabled, fileKey, scope]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (active.current?.dirty || active.current?.saving) event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, []);
  useEffect(() => {
    if (!registerCloseGuard) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void registerCloseGuard((close) => {
      void (active.current?.flush() ?? Promise.resolve(true)).then((saved) => {
        if (saved) close();
      });
    })
      .then((cleanup) => {
        if (disposed) cleanup();
        else unlisten = cleanup;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [registerCloseGuard]);
  const current = enabled && loaded?.fileKey === fileKey ? loaded : null;
  const Editor = current?.module.TextFileEditor;
  return {
    ready: current !== null,
    element:
      current && Editor ? (
        <Editor session={current.session} {...(lineNumber === undefined ? {} : { lineNumber })} />
      ) : null,
    hasUnsavedChanges: () =>
      active.current !== null && (active.current.dirty || active.current.saving),
    flush: () => active.current?.flush() ?? Promise.resolve(true),
    getContent: () => active.current?.state.sliceDoc() ?? "",
    runAfterSave: (action: () => void) => {
      void (active.current?.flush() ?? Promise.resolve(true)).then((saved) => {
        if (saved) action();
      });
    },
  };
}
