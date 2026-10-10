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
  checkRevision: (signal: AbortSignal) => Promise<{ revision: string }>;
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
    scope: object;
    session: TextEditorAutosave;
    module: EditorModule;
  } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    // 回调绑定本次文件身份，迟到的保存不能写入刚切换到的另一个文件。
    const current = callbacks.current;
    let release: (() => void) | undefined;
    setLoaded(null);
    // 先查询共享会话，再决定是否读取；草稿、已保存状态及在途请求都不会重复读取全文。
    void import("./text-file-editor.js")
      .then(async (editor) => {
        if (controller.signal.aborted) return;
        const lease = editor.getTextEditorSessionCache(scope).acquire(fileKey, current);
        release = lease.release;
        const value = await lease.ready;
        controller.signal.throwIfAborted();
        value.setCallbacks(current.save, current.onSaved, current.notify);
        active.current = value;
        setLoaded({ fileKey, scope, session: value, module: editor });
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
      release?.();
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
  const current = enabled && loaded?.fileKey === fileKey && loaded.scope === scope ? loaded : null;
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
