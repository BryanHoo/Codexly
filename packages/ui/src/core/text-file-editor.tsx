import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
} from "@codemirror/view";
import { defaultKeymap, historyKeymap } from "@codemirror/commands";
import { bracketMatching, defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { useEffect, useLayoutEffect, useRef } from "react";
import { loadTextEditorLanguage } from "./text-editor-languages.js";
import type { TextEditorAutosave } from "./text-editor-autosave.js";
import { MAX_TEXT_EDITOR_PARSE_BYTES } from "./text-editor-state.js";
export {
  TextEditorAutosave,
  getTextEditorDraft,
  retainTextEditorDraft,
} from "./text-editor-autosave.js";
export { getTextEditorSessionCache } from "./text-editor-session-cache.js";

export type TextFileEditorProps = Readonly<{
  session: TextEditorAutosave;
  lineNumber?: number | null;
}>;

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    color: "var(--color-foreground)",
    backgroundColor: "var(--color-content)",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "var(--font-mono, monospace)",
    fontSize: "14px",
    overscrollBehavior: "contain",
  },
  ".cm-content": { padding: "12px 0", caretColor: "var(--color-foreground)" },
  ".cm-gutters": {
    backgroundColor: "var(--color-raised)",
    color: "var(--color-muted-foreground)",
    border: "none",
  },
  ".cm-activeLine": { backgroundColor: "var(--color-control-hover)" },
  "&.cm-focused": { outline: "none" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--color-brand) 25%, transparent)",
  },
  ".cm-cursor": { borderLeftColor: "var(--color-foreground)" },
  ".cm-panels": { backgroundColor: "var(--color-raised)", color: "var(--color-foreground)" },
  ".cm-textfield, .cm-button": {
    color: "inherit",
    background: "var(--color-content)",
    border: "1px solid var(--color-muted-foreground)",
    borderRadius: "4px",
    fontSize: "14px",
  },
});

export function TextFileEditor({ session, lineNumber }: TextFileEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  useLayoutEffect(() => {
    if (!host.current) return;
    let disposed = false;
    let languagePending = false;
    const ensureLanguage = () => {
      if (
        disposed ||
        session.languageLoaded ||
        languagePending ||
        session.byteLength > MAX_TEXT_EDITOR_PARSE_BYTES
      )
        return;
      languagePending = true;
      void loadTextEditorLanguage(session.file.path)
        .then((extension) => {
          if (!disposed)
            view.dispatch({
              effects: session.installLanguage([
                extension,
                syntaxHighlighting(defaultHighlightStyle),
                bracketMatching(),
              ]),
            });
        })
        .catch(() => undefined)
        .finally(() => {
          languagePending = false;
        });
    };
    const state = session.bindView([
      lineNumbers(),
      drawSelection(),
      highlightActiveLine(),
      editorTheme,
      keymap.of([
        {
          key: "Mod-s",
          run: () => {
            void session.flush();
            return true;
          },
        },
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      EditorView.contentAttributes.of({
        "aria-label": session.file.path,
        spellcheck: "false",
        autocapitalize: "off",
        autocorrect: "off",
      }),
      EditorView.updateListener.of((update) => {
        // 文本留在 CodeMirror 文本树中；输入不触发网络请求，也不复制到 React state。
        let changedBytes = 0;
        update.changes.iterChanges((from, to, _from, _to, inserted) => {
          changedBytes += (to - from + inserted.length) * 8;
        });
        // 选择、语言及撤销事务也须留在会话中，重新挂载才不会重置状态。
        session.update(update.state, changedBytes);
        if (update.docChanged) {
          ensureLanguage();
          // DOM / 输入法事务可能晚于 blur 到达；失焦后提交的字符也必须补存。
          if (!update.view.hasFocus)
            queueMicrotask(() => {
              void session.flush();
            });
        }
      }),
      EditorView.domEventHandlers({
        blur: () => {
          void session.flush();
        },
        compositionend: (_event, view) => {
          // 输入法在失焦之后才提交最终字符时，等待本轮事务应用后补存。
          queueMicrotask(() => {
            if (!disposed && !view.hasFocus) void session.flush();
          });
        },
      }),
    ]);
    const view = new EditorView({
      parent: host.current,
      state,
      ...(session.scrollSnapshot ? { scrollTo: session.scrollSnapshot } : {}),
    });
    viewRef.current = view;
    // 预览加载不能抢走聊天输入框焦点；用户直接点击正文即可编辑。
    // 语言与解析状态属于会话，切屏不反复创建解析器和语法树。
    ensureLanguage();
    const onWindowBlur = () => {
      void session.flush();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void session.flush();
    };
    window.addEventListener("blur", onWindowBlur);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      window.removeEventListener("blur", onWindowBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      // 布局清理发生在 DOM 移除之前；被动 effect 清理时滚动布局已经归零。
      session.scrollSnapshot = view.scrollSnapshot();
      session.update(view.state);
      session.bindView([]);
      viewRef.current = null;
      view.destroy();
    };
  }, [session]);
  useEffect(() => {
    const view = viewRef.current;
    if (lineNumber === session.navigationLine) return;
    session.navigationLine = lineNumber;
    if (!view || !lineNumber || lineNumber < 1) return;
    const position = view.state.doc.line(Math.min(lineNumber, view.state.doc.lines)).from;
    view.dispatch({
      selection: { anchor: position },
      effects: EditorView.scrollIntoView(position, { y: "center" }),
    });
  }, [session, lineNumber]);
  return (
    <div
      ref={host}
      className="h-full min-h-0 overflow-hidden bg-content"
      data-inline-text-editor=""
    />
  );
}
