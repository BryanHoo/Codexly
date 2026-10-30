import { textFileEditorChinese } from "@codexly/frontend-core/text-file-editor";
import { getTextEditorLabels } from "./text-editor-labels.js";
import { useEffect, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import type {
  ProjectTextFile,
  TextFileEditorLabels,
} from "@codexly/frontend-core/text-file-editor";
import type { TextEditorAutosave } from "./text-editor-autosave.js";
import { editorTheme } from "./text-editor-theme.js";
import { Button } from "./button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog.js";

export function TextEditorConflict({
  session,
  read,
  labels: baseLabels = textFileEditorChinese,
  onClose,
}: Readonly<{
  session: TextEditorAutosave;
  read: (signal: AbortSignal) => Promise<ProjectTextFile>;
  labels?: TextFileEditorLabels;
  onClose: () => void;
}>) {
  const labels = getTextEditorLabels(baseLabels);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [snapshot] = useState(() => ({
    doc: session.state.doc,
    content: session.state.sliceDoc(),
  }));
  const [disk, setDisk] = useState<ProjectTextFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState<"disk" | "draft" | null>(null);
  const lock = useRef(false);
  const readRef = useRef(read);
  readRef.current = read;
  useEffect(() => {
    if (!host) return;
    const controller = new AbortController();
    let view: EditorView | undefined;
    setError(null);
    setDisk(null);
    // 只有显式比较才读取完整磁盘版本并下载差异模块；关闭立即取消读取和释放视图。
    void Promise.all([readRef.current(controller.signal), import("@codemirror/merge")])
      .then(([file, { unifiedMergeView }]) => {
        if (controller.signal.aborted) return;
        view = new EditorView({
          parent: host,
          state: EditorState.create({
            doc: snapshot.content.replace(/\r\n/g, "\n"),
            extensions: [
              editorTheme,
              lineNumbers(),
              EditorState.readOnly.of(true),
              EditorView.editable.of(false),
              EditorState.phrases.of(labels.phrases),
              EditorView.contentAttributes.of({ "aria-label": labels.compare, tabindex: "0" }),
              unifiedMergeView({
                original: file.content.replace(/\r\n/g, "\n"),
                mergeControls: false,
                syntaxHighlightDeletions: false,
                // 大文件或完全不同正文也要有界：超预算降低差异精度，完整正文仍可查看。
                diffConfig: { scanLimit: 500, timeout: 50 },
                collapseUnchanged: { margin: 3, minSize: 8 },
              }),
            ],
          }),
        });
        setDisk(file);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(labels.compareError);
      });
    return () => {
      controller.abort();
      view?.destroy();
    };
  }, [host, session, snapshot, attempt, labels]);
  const confirm = async () => {
    if (!disk || lock.current) return;
    if (session.saving || session.state.doc !== snapshot.doc) {
      setError(labels.staleComparison);
      setChoice(null);
      return;
    }
    lock.current = true;
    setBusy(true);
    try {
      const success =
        choice === "disk"
          ? session.useDiskVersion(disk, snapshot.doc)
          : await session.saveComparedDraft(disk, snapshot.doc);
      if (success) onClose();
      else {
        setError(session.feedback === "conflict" ? labels.conflict : labels.saveError);
        setChoice(null);
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !lock.current) onClose();
      }}
    >
      <DialogContent
        className="flex h-[min(80dvh,44rem)] max-w-5xl flex-col gap-3 p-4"
        closeLabel={labels.close}
        closeDisabled={busy}
      >
        <DialogHeader>
          <DialogTitle>
            {session.feedback === "conflict" ? labels.conflictTitle : labels.compare}
          </DialogTitle>
          <DialogDescription>{labels.compareDescription}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-label">
          <span className="text-danger">− {labels.disk}</span>
          <span className="text-brand">+ {labels.draft}</span>
        </div>
        {error ? (
          <div role="alert" className="flex flex-wrap items-center gap-2 text-label text-danger">
            <span className="min-w-0 flex-1">{error}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => {
                setChoice(null);
                setAttempt((n) => n + 1);
              }}
            >
              {labels.compare}
            </Button>
          </div>
        ) : null}
        {!disk && !error ? (
          <p role="status" className="text-label">
            {labels.retrying}
          </p>
        ) : null}
        <div
          ref={setHost}
          className="min-h-0 min-w-0 flex-1 overflow-hidden rounded-control border border-separator"
          data-text-editor-comparison=""
        />
        {choice ? (
          <p role="alert" className="text-body-small">
            {choice === "disk" ? labels.confirmReload : labels.confirmReplace}
          </p>
        ) : null}
        <DialogFooter className="flex-wrap">
          {choice ? (
            <>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setChoice(null);
                }}
              >
                {labels.cancel}
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  void confirm();
                }}
              >
                {busy ? labels.saving : labels.confirm}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" disabled={busy} onClick={onClose}>
                {labels.keepEditing}
              </Button>
              <Button
                variant="outline"
                disabled={!disk || busy || !!error}
                onClick={() => {
                  setChoice("disk");
                }}
              >
                {labels.reloadDisk}
              </Button>
              <Button
                disabled={!disk || busy || !!error}
                onClick={() => {
                  setChoice("draft");
                }}
              >
                {labels.replaceDisk}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
