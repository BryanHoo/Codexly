import { useCallback, useSyncExternalStore, type RefObject } from "react";
import { redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import { gotoLine, openSearchPanel } from "@codemirror/search";
import type { EditorView } from "@codemirror/view";
import { Check, Circle, LoaderCircle, Redo2, Search, Undo2, WrapText } from "lucide-react";
import type { TextEditorLabels } from "./text-editor-labels.js";
import { getCodeLanguage } from "../agent/code-languages.js";
import type { TextEditorAutosave } from "./text-editor-autosave.js";
import { TextEditorAction } from "./text-editor-action.js";
import { ButtonGroup } from "./button-group.js";

type Props = Readonly<{
  session: TextEditorAutosave;
  labels: TextEditorLabels;
  viewRef: RefObject<EditorView | null>;
}>;

function useEditorSnapshot(session: TextEditorAutosave, read: () => string) {
  return useSyncExternalStore(
    useCallback((listener) => session.subscribe(listener), [session]),
    read,
    read,
  );
}

export function TextEditorToolbar({
  session,
  labels,
  viewRef,
  wrapping,
  onWrap,
}: Props & Readonly<{ wrapping: boolean; onWrap: () => void }>) {
  const history = useEditorSnapshot(session, () =>
    [
      undoDepth(session.state) > 0,
      redoDepth(session.state) > 0,
      session.dirty,
      session.saving,
    ].join(":"),
  );
  const [canUndo, canRedo, dirty, saving] = history.split(":");
  const command = (run: (view: EditorView) => boolean) => {
    if (viewRef.current) {
      run(viewRef.current);
      viewRef.current.focus();
    }
  };
  return (
    <div
      className="flex shrink-0 items-center gap-2 border-b border-separator bg-content px-2 py-1.5"
      role="group"
      aria-label={labels.toolbar}
      data-text-editor-toolbar=""
    >
      <ButtonGroup className="gap-0.5" aria-label={labels.history}>
        <TextEditorAction
          label={labels.undo}
          shortcut="⌘/Ctrl+Z"
          size="icon-sm"
          variant="ghost"
          disabled={canUndo !== "true"}
          onClick={() => {
            command(undo);
          }}
        >
          <Undo2 aria-hidden="true" />
        </TextEditorAction>
        <TextEditorAction
          label={labels.redo}
          size="icon-sm"
          variant="ghost"
          disabled={canRedo !== "true"}
          onClick={() => {
            command(redo);
          }}
        >
          <Redo2 aria-hidden="true" />
        </TextEditorAction>
      </ButtonGroup>
      <span aria-hidden="true" className="h-4 border-l border-separator" />
      <ButtonGroup className="gap-0.5" aria-label={labels.view}>
        <TextEditorAction
          label={labels.find}
          shortcut="⌘/Ctrl+F"
          size="icon-sm"
          variant="ghost"
          onClick={() => {
            if (viewRef.current) openSearchPanel(viewRef.current);
          }}
        >
          <Search aria-hidden="true" />
        </TextEditorAction>
        <TextEditorAction
          label={labels.wrap}
          shortcut="Alt+Z"
          aria-pressed={wrapping}
          size="icon-sm"
          variant="ghost"
          className={wrapping ? "bg-brand-soft text-brand hover:text-brand" : undefined}
          onClick={onWrap}
        >
          <WrapText aria-hidden="true" />
        </TextEditorAction>
      </ButtonGroup>
      <span className="min-w-0 flex-1" />
      <TextEditorAction
        label={labels.save}
        shortcut="⌘/Ctrl+S"
        size="sm"
        className="px-4"
        disabled={dirty !== "true" || saving === "true"}
        onClick={() => {
          void session.flush();
        }}
      >
        {saving === "true" ? (
          <LoaderCircle aria-hidden="true" className="size-3.5 motion-safe:animate-spin" />
        ) : null}
        {labels.save}
      </TextEditorAction>
    </div>
  );
}

export function TextEditorStatus({ session, labels, viewRef }: Props) {
  // 只发布几个标量，光标移动不触发父级或正文重渲染，也不序列化文档。
  const value = useEditorSnapshot(session, () => {
    const { state } = session;
    const line = state.doc.lineAt(state.selection.main.head);
    const status = session.saving
      ? "saving"
      : session.feedback === "conflict"
        ? "conflicted"
        : session.feedback === "error"
          ? "failed"
          : session.dirty
            ? "dirty"
            : "clean";
    return `${status}|${String(line.number)}|${String(state.selection.main.head - line.from + 1)}|${state.lineBreak === "\r\n" ? "CRLF" : "LF"}|${state.doc.sliceString(0, 1) === "\uFEFF" ? "UTF-8 BOM" : "UTF-8"}`;
  });
  const [status, line, column, ending, encoding] = value.split("|");
  const stateLabel = labels[status as "saving" | "conflicted" | "failed" | "dirty" | "clean"];
  const Icon = status === "saving" ? LoaderCircle : status === "clean" ? Check : Circle;
  const language = getCodeLanguage(session.file.path);
  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-separator bg-raised px-2 py-1 text-label text-muted-foreground"
      data-text-editor-status=""
    >
      <span
        className={`inline-flex items-center gap-1 ${status === "failed" || status === "conflicted" ? "text-danger" : ""}`}
        role="status"
        title={labels.saveHint}
      >
        <Icon
          aria-hidden="true"
          className={`size-3 ${status === "saving" ? "motion-safe:animate-spin" : ""}`}
        />
        {stateLabel}
      </span>
      <span className="flex-1" />
      <TextEditorAction
        label={labels.goToLine}
        size="toolbar"
        variant="ghost"
        onClick={() => {
          if (viewRef.current) gotoLine(viewRef.current);
        }}
      >
        {labels.position.replace("$1", line ?? "1").replace("$2", column ?? "1")}
      </TextEditorAction>
      <span>{encoding}</span>
      <span>{ending}</span>
      <span>{language === "text" ? labels.plainLanguage : language}</span>
    </div>
  );
}
