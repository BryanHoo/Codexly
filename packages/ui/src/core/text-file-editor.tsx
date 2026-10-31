export { DocumentEditorRegistry } from "./document-editor-registry.js";
export { TextEditorCloseDialog } from "./text-editor-close-dialog.js";
import { createTextEditorSearchPanel } from "./text-editor-search.js";
import { getTextEditorLabels } from "./text-editor-labels.js";
import { EditorState, Compartment } from "@codemirror/state";
import { search, searchKeymap } from "@codemirror/search";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import {
  textFileEditorChinese,
  type TextFileEditorLabels,
} from "@codexly/frontend-core/text-file-editor";
import { TextEditorToolbar, TextEditorStatus } from "./text-editor-chrome.js";
import { editorTheme, editorHighlightStyle } from "./text-editor-theme.js";
import { formatDisplayPath } from "@codexly/frontend-core/display-path";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
} from "@codemirror/view";
import { defaultKeymap, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  bracketMatching,
  syntaxHighlighting,
  foldGutter,
  foldKeymap,
  indentOnInput,
} from "@codemirror/language";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { loadTextEditorLanguage } from "./text-editor-languages.js";
import type { TextEditorAutosave } from "./text-editor-autosave.js";
import { MAX_TEXT_EDITOR_PARSE_BYTES } from "./text-editor-state.js";
export {
  TextEditorAutosave,
  getTextEditorDraft,
  retainTextEditorDraft,
} from "./text-editor-autosave.js";
export { TextEditorConflict } from "./text-editor-conflict.js";
export { getTextEditorSessionCache } from "./text-editor-session-cache.js";

export type TextFileEditorProps = Readonly<{
  session: TextEditorAutosave;
  lineNumber?: number | null;
  labels?: TextFileEditorLabels;
}>;

export function TextFileEditor({
  session,
  lineNumber,
  labels: baseLabels = textFileEditorChinese,
}: TextFileEditorProps) {
  const labels = getTextEditorLabels(baseLabels);
  const frame = useRef<HTMLDivElement>(null);
  const [wrapping, setWrapping] = useState(false);
  const wrap = useRef(new Compartment());
  const wrappingRef = useRef(wrapping);
  const toggleWrap = () => {
    wrappingRef.current = !wrappingRef.current;
    setWrapping(wrappingRef.current);
    viewRef.current?.dispatch({
      effects: wrap.current.reconfigure(wrappingRef.current ? EditorView.lineWrapping : []),
    });
  };
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
                syntaxHighlighting(editorHighlightStyle),
                bracketMatching(),
              ]),
            });
        })
        .catch(() => undefined)
        .finally(() => {
          languagePending = false;
        });
    };
    const bindings = [
      lineNumbers(),
      drawSelection(),
      highlightActiveLine(),
      editorTheme,
      wrap.current.of(wrappingRef.current ? EditorView.lineWrapping : []),
      EditorState.phrases.of(labels.phrases),
      EditorState.allowMultipleSelections.of(true),
      search({ top: true, createPanel: createTextEditorSearchPanel }),
      foldGutter(),
      indentOnInput(),
      closeBrackets(),
      // 剪贴板换行由来源平台决定；先匹配当前文件格式，避免粘贴后混入 CRLF/LF 而无法保存。
      EditorView.clipboardInputFilter.of((text, current) =>
        text.replace(/\r\n?|\n/g, current.lineBreak),
      ),
      keymap.of([
        {
          key: "Mod-s",
          scope: "editor search-panel",
          run: () => {
            void session.flush();
            return true;
          },
        },
        {
          key: "Alt-z",
          run: () => {
            toggleWrap();
            return true;
          },
        },
        // Escape 后 Tab 仍可离开编辑器；沿用 CodeMirror 的键盘逃离机制。
        indentWithTab,
        ...searchKeymap,
        ...foldKeymap,
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      EditorView.contentAttributes.of({
        "aria-label": formatDisplayPath(session.file.path),
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
        if (update.docChanged) ensureLanguage();
      }),
    ];
    const state = session.bindView(bindings);
    const view = new EditorView({
      parent: host.current,
      state,
      ...(session.scrollSnapshot ? { scrollTo: session.scrollSnapshot } : {}),
    });
    viewRef.current = view;
    const unlisten = session.subscribe(() => {
      // 普通输入已同步到视图；只有确认放弃等外部状态重建才重绑视图，避免逐键重渲染。
      if (view.state !== session.state) {
        view.setState(session.bindView(bindings));
        ensureLanguage();
      }
    });
    // 预览加载不能抢走聊天输入框焦点；用户直接点击正文即可编辑。
    // 语言与解析状态属于会话，切屏不反复创建解析器和语法树。
    ensureLanguage();
    return () => {
      disposed = true;
      unlisten();
      // 布局清理发生在 DOM 移除之前；被动 effect 清理时滚动布局已经归零。
      session.scrollSnapshot = view.scrollSnapshot();
      session.update(view.state);
      session.bindView([]);
      viewRef.current = null;
      view.destroy();
    };
  }, [session, labels]);
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
      ref={frame}
      className="file-theme flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-content"
      data-inline-text-editor=""
      onKeyDown={(event) => {
        // 工具栏也属于当前文件；在按钮上按保存快捷键不能触发浏览器“另存网页”。
        if (
          !event.defaultPrevented &&
          (event.metaKey || event.ctrlKey) &&
          !event.altKey &&
          event.key.toLowerCase() === "s"
        ) {
          event.preventDefault();
          event.stopPropagation();
          void session.flush();
        }
      }}
      onMouseDownCapture={(event) => {
        // 命令按钮保留正文选区与焦点；WebKit 点击按钮默认不会聚焦，须避免短暂落到 body。
        const button = event.target instanceof Element ? event.target.closest("button") : null;
        if (button instanceof HTMLButtonElement) {
          event.preventDefault();
          button.focus();
        }
      }}
    >
      <TextEditorToolbar
        session={session}
        labels={labels}
        viewRef={viewRef}
        wrapping={wrapping}
        onWrap={toggleWrap}
      />
      <div ref={host} className="min-h-0 min-w-0 flex-1 overflow-hidden" />
      <TextEditorStatus session={session} labels={labels} viewRef={viewRef} />
    </div>
  );
}
