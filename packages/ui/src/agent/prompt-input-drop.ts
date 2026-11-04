import { useEffect, useEffectEvent, type RefObject } from "react";
import type { PromptInputAttachment } from "./prompt-input-context.js";

export type NativeAttachmentDropEvent =
  | { type: "leave" }
  | { type: "enter" | "over" | "drop"; x: number; y: number; paths: readonly string[] };
export type NativeAttachmentDrop = Readonly<{
  subscribe: (listener: (event: NativeAttachmentDropEvent) => void) => Promise<() => void>;
  importPath: (path: string) => Promise<PromptInputAttachment>;
}>;

/** 只把文件交给落点所在的输入区；原生文件内容始终留在平台层。 */
export function usePromptInputDrop({
  formRef,
  enabled,
  disabled,
  resetKey,
  nativeDrop,
  addFiles,
  onError,
  reveal,
}: {
  formRef: RefObject<HTMLFormElement | null>;
  enabled: boolean;
  disabled: boolean;
  resetKey: string | undefined;
  nativeDrop: NativeAttachmentDrop | undefined;
  addFiles: (files: readonly (File | PromptInputAttachment)[]) => void;
  onError: ((error: Error) => void) | undefined;
  reveal: (() => void) | undefined;
}) {
  const append = useEffectEvent(addFiles);
  const report = useEffectEvent((error: unknown) =>
    onError?.(error instanceof Error ? error : new Error(String(error))),
  );
  const show = useEffectEvent(() => reveal?.());
  useEffect(() => {
    const form = formRef.current;
    if (!enabled || form === null) return;
    // 分屏容器始终包含消息区和输入区；弹窗等独立编辑器只接收自身表单。
    const scope = form.closest<HTMLElement>("[data-split-pane]") ?? form;
    let disposed = false;
    const isCurrent = () => !disposed;
    let queue = Promise.resolve();
    const highlight = (active: boolean) => {
      if (active) {
        if (form.dataset["dragActive"] !== "true") form.dataset["dragActive"] = "true";
      } else if (form.dataset["dragActive"] !== undefined) delete form.dataset["dragActive"];
    };
    const acceptsTarget = (target: EventTarget | null) =>
      target instanceof Node && scope.contains(target);
    const over = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = disabled ? "none" : "copy";
      highlight(!disabled);
    };
    const leave = (event: DragEvent) => {
      if (!acceptsTarget(event.relatedTarget)) highlight(false);
    };
    const drop = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      highlight(false);
      if (disabled) return;
      // DataTransfer 在 drop 回调以外受保护，必须同步取得 File 引用。
      const files = Array.from(event.dataTransfer.files);
      if (files.length) {
        append(files);
        show();
      }
    };
    scope.addEventListener("dragover", over);
    scope.addEventListener("dragleave", leave);
    scope.addEventListener("drop", drop);
    const unsubscribe = nativeDrop?.subscribe((event) => {
      if (disposed) return;
      const inside =
        event.type !== "leave" && acceptsTarget(document.elementFromPoint(event.x, event.y));
      highlight(inside && !disabled && event.type !== "drop");
      if (!inside || disabled || event.type !== "drop") return;
      show();
      // 顺序导入限制磁盘/IPC 并发，并在每次完成后使用最新附件容量校验。
      queue = queue.then(async () => {
        for (const path of new Set(event.paths)) {
          if (disposed) break;
          try {
            const attachment = await nativeDrop.importPath(path);
            if (isCurrent()) append([attachment]);
          } catch (error) {
            if (isCurrent()) report(error);
          }
        }
      });
    });
    void unsubscribe?.catch((error: unknown) => {
      if (isCurrent()) report(error);
    });
    return () => {
      disposed = true;
      highlight(false);
      scope.removeEventListener("dragover", over);
      scope.removeEventListener("dragleave", leave);
      scope.removeEventListener("drop", drop);
      // 订阅尚未完成就卸载时，仍在注册完成后立即释放原生监听。
      void unsubscribe
        ?.then((unlisten) => {
          unlisten();
        })
        .catch(() => undefined);
    };
  }, [disabled, enabled, formRef, nativeDrop, resetKey]);
}
