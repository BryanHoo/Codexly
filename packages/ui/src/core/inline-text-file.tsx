import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { TextEditorNoticeKind } from "./text-editor-notice.js";
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
  notify: (result: TextEditorSaveResult | "load-error" | "capacity") => void;
  registerCloseGuard?: (requestClose: (close: () => void) => void) => Promise<() => void>;
}>;

export function useInlineTextFile(options: InlineTextFileOptions) {
  const { enabled, fileKey, scope, lineNumber, registerCloseGuard } = options;
  const callbacks = useRef(options);
  callbacks.current = options;
  const active = useRef<TextEditorAutosave | null>(null);
  const [failed, setFailed] = useState<{
    fileKey: string;
    scope: object;
    reason: TextEditorNoticeKind;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [loaded, setLoaded] = useState<{
    fileKey: string;
    scope: object;
    session: TextEditorAutosave;
    module: EditorModule;
  } | null>(null);
  useEffect(() => {
    // 原文件重试时继续显示只读内容和原因；切换身份才清掉旧提示，成功后原位恢复编辑。
    setFailed((previous) =>
      previous?.fileKey === fileKey && previous.scope === scope ? previous : null,
    );
    setLoaded(null);
    if (!enabled) return;
    setRetrying(true);
    const controller = new AbortController();
    // 回调绑定本次文件身份，迟到的保存不能写入刚切换到的另一个文件。
    const current = callbacks.current;
    let release: (() => void) | undefined;
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
        setFailed(null);
        setLoaded({ fileKey, scope, session: value, module: editor });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        // 全文读取或模块加载失败后才允许分页回退；失败身份隔离，不能影响新文件。
        // 不可编辑的文件继续原有只读预览；网络等异常才提示，避免每次预览都弹错误。
        const code =
          typeof error === "object" && error !== null && "code" in error ? error.code : null;
        const reason =
          code === "TEXT_EDITOR_CAPACITY"
            ? "capacity"
            : code === "TEXT_FILE_UNSUPPORTED"
              ? "unsupported"
              : "load-error";
        setFailed({ fileKey, scope, reason });
        // 失败的读取立即释放租约；重试无需离开当前文件，也不会持续占用会话用户数。
        release?.();
        release = undefined;
        if (code !== "TEXT_FILE_UNSUPPORTED")
          current.notify(code === "TEXT_EDITOR_CAPACITY" ? "capacity" : "load-error");
      })
      .finally(() => {
        if (!controller.signal.aborted) setRetrying(false);
      });
    return () => {
      controller.abort();
      active.current = null;
      release?.();
    };
  }, [enabled, fileKey, scope, attempt]);
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
  const fallback = enabled && failed?.fileKey === fileKey && failed.scope === scope;
  const session = current?.session;
  const subscribe = useCallback(
    (listener: () => void) => session?.subscribe(listener) ?? (() => undefined),
    [session],
  );
  const getFeedback = useCallback(
    (): TextEditorNoticeKind | null =>
      session?.feedback ?? (session && session.byteLength > 256 * 1024 ? "plain-text" : null),
    [session],
  );
  // 只订阅原因和保存中这两个离散状态，普通输入不会把全文或逐键更新带入 React。
  const feedback = useSyncExternalStore(subscribe, getFeedback, () => null);
  const saving = useSyncExternalStore(
    subscribe,
    useCallback(() => session?.saving ?? false, [session]),
    () => false,
  );
  // 预览仅在切入 Markdown 时按需序列化文本树，不把全文另存到 Query 缓存或输入状态。
  const getContent = useCallback(() => active.current?.state.sliceDoc() ?? "", []);
  const Editor = current?.module.TextFileEditor;
  return {
    ready: current !== null,
    loading: enabled && current === null && !fallback,
    fallback,
    noticeKind: fallback ? failed.reason : feedback,
    saving,
    retrying,
    retryEdit: () => {
      setAttempt((value) => value + 1);
    },
    retrySave: () => {
      void active.current?.flush();
    },
    dismissNotice: () => {
      active.current?.dismissInputLimit();
    },
    path: current?.session.file.path,
    element:
      current && Editor ? (
        <Editor session={current.session} {...(lineNumber === undefined ? {} : { lineNumber })} />
      ) : null,
    hasUnsavedChanges: () =>
      active.current !== null && (active.current.dirty || active.current.saving),
    flush: () => active.current?.flush() ?? Promise.resolve(true),
    getContent,
    runAfterSave: (action: () => void) => {
      void (active.current?.flush() ?? Promise.resolve(true)).then((saved) => {
        if (saved) action();
      });
    },
  };
}
