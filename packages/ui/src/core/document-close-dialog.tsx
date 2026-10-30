import { useRef, useSyncExternalStore } from "react";
import type { DocumentEditorRegistry } from "./document-editor-registry.js";
import { Button } from "./button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog.js";

export function DocumentCloseDialog({
  registry,
  english = false,
}: Readonly<{ registry: DocumentEditorRegistry; english?: boolean }>) {
  const request = useSyncExternalStore(registry.subscribe, registry.getRequest, () => null);
  const cancel = useRef<HTMLButtonElement>(null);
  if (!request) return null;
  const saving = request.busy || request.entries.some(({ binding }) => binding.isSaving());
  const labels = english
    ? {
        title:
          request.reason === "switch-project"
            ? "Save changes before switching projects?"
            : "Save changes before closing?",
        description:
          request.reason === "switch-project"
            ? "Switching projects closes the file tabs. Save your changes or choose Don't save to discard them."
            : "Unsaved changes will be lost if you close without saving.",
        save: "Save",
        saveAll: "Save all",
        discard: "Don't save",
        cancel: "Cancel",
        saving: "Saving…",
      }
    : {
        title: request.reason === "switch-project" ? "切换项目前保存更改？" : "关闭前保存更改？",
        description:
          request.reason === "switch-project"
            ? "切换到其他项目的任务将关闭当前文件标签。请选择保存更改后切换，或不保存并放弃修改。"
            : "选择“不保存”将丢弃这些文件的未保存修改。",
        save: "保存",
        saveAll: "全部保存",
        discard: "不保存",
        cancel: "取消",
        saving: "正在保存…",
      };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !request.busy) registry.cancelClose();
      }}
    >
      <DialogContent
        closeLabel={labels.cancel}
        closeDisabled={request.busy}
        initialFocus={cancel}
        className="max-w-md p-4"
      >
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>
        <ul className="max-h-40 overflow-auto text-body-small">
          {request.entries.map(({ id, binding }) => (
            <li key={id} className="truncate py-1" title={binding.path}>
              {binding.path}
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button
            ref={cancel}
            variant="outline"
            disabled={request.busy}
            onClick={() => {
              registry.cancelClose();
            }}
          >
            {labels.cancel}
          </Button>
          {/* 放弃修改使用有底色的次级按钮，始终可见并与蓝色保存主按钮区分。 */}
          <Button
            variant="outline"
            className="bg-control"
            disabled={saving}
            onClick={() => {
              void registry.resolveClose("discard");
            }}
          >
            {labels.discard}
          </Button>
          <Button
            disabled={saving}
            onClick={() => {
              void registry.resolveClose("save");
            }}
          >
            {saving ? labels.saving : request.entries.length > 1 ? labels.saveAll : labels.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
