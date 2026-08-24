import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormHTMLAttributes,
  type SubmitEvent,
} from "react";
import { v4 as createUuid } from "uuid";
import { useTranslation } from "../../../i18n/i18n.js";

import {
  PromptInputAttachmentsContext,
  type PromptInputAttachment,
  type PromptInputAttachmentsContextValue,
  type PromptInputError,
  type PromptInputMessage,
} from "./prompt-input-context.js";

type PromptInputProps = Omit<FormHTMLAttributes<HTMLFormElement>, "onError" | "onSubmit"> & {
  attachments?: readonly PromptInputAttachment[];
  disabled?: boolean;
  fileAccept?: string;
  globalDrop?: boolean;
  imageAccept?: string;
  maxFileTotalSize?: number;
  maxFileSize?: number;
  maxImageSize?: number;
  maxImages?: number;
  maxImageTotalSize?: number;
  multiple?: boolean;
  largePasteCharacterThreshold?: number;
  onAttachmentsChange?: (files: readonly PromptInputAttachment[]) => void;
  onError?: (error: PromptInputError) => void;
  onSubmit?: (message: PromptInputMessage, event: SubmitEvent<HTMLFormElement>) => void;
  pastedTextFileName?: string;
  resetKey?: string;
};

export function createPastedTextFile(
  text: string,
  characterThreshold: number,
  fileName: string,
): File | undefined {
  let characterCount = 0;
  // 按 Unicode 字符计数，并在越过阈值时立即返回，避免复制整段大文本。
  for (let offset = 0; offset < text.length;) {
    const codePoint = text.codePointAt(offset);
    if (codePoint === undefined) {
      break;
    }
    offset += codePoint > 0xffff ? 2 : 1;
    characterCount += 1;
    if (characterCount > characterThreshold) {
      return new File([text], fileName, { type: "text/plain" });
    }
  }
  return undefined;
}

function acceptsFile(file: File, accept: string | undefined): boolean {
  if (accept === undefined || accept.trim() === "") {
    return true;
  }
  return accept.split(",").some((value) => {
    const rule = value.trim();
    if (rule.startsWith(".")) {
      return file.name.toLowerCase().endsWith(rule.toLowerCase());
    }
    return rule.endsWith("/*") ? file.type.startsWith(rule.slice(0, -1)) : file.type === rule;
  });
}

function revokePreview(attachment: PromptInputAttachment) {
  if (attachment.previewUrl.startsWith("blob:")) {
    URL.revokeObjectURL(attachment.previewUrl);
  }
}

export function PromptInput({
  attachments,
  children,
  className = "",
  disabled = false,
  fileAccept,
  globalDrop = false,
  imageAccept,
  largePasteCharacterThreshold = Number.POSITIVE_INFINITY,
  maxFileTotalSize = Number.POSITIVE_INFINITY,
  maxFileSize = Number.POSITIVE_INFINITY,
  maxImageSize = Number.POSITIVE_INFINITY,
  maxImages = Number.POSITIVE_INFINITY,
  maxImageTotalSize = Number.POSITIVE_INFINITY,
  multiple = false,
  onAttachmentsChange,
  onError,
  onPaste,
  onPasteCapture,
  onSubmit,
  pastedTextFileName = "Pasted text.txt",
  resetKey,
  ...props
}: PromptInputProps) {
  const { t } = useTranslation("conversation");
  const [internalFiles, setInternalFiles] = useState<PromptInputAttachment[]>([]);
  const files = attachments ?? internalFiles;
  const filesRef = useRef(files);
  const controlledRef = useRef(attachments !== undefined);
  const previousResetKeyRef = useRef(resetKey);
  filesRef.current = files;
  controlledRef.current = attachments !== undefined;

  const updateFiles = useCallback(
    (update: (current: readonly PromptInputAttachment[]) => readonly PromptInputAttachment[]) => {
      if (attachments !== undefined) {
        onAttachmentsChange?.(update(attachments));
        return;
      }
      setInternalFiles((current) => [...update(current)]);
    },
    [attachments, onAttachmentsChange],
  );

  const addFiles = useCallback(
    (incoming: readonly File[], allowGeneratedText = false) => {
      updateFiles((current) => {
        if (disabled) {
          return current;
        }
        const accepted: PromptInputAttachment[] = [];
        let imageCount = current.filter((file) => file.kind === "image").length;
        let imageBytes = current.reduce(
          (total, file) => total + (file.kind === "image" ? file.size : 0),
          0,
        );
        let fileBytes = current.reduce(
          (total, file) => total + (file.kind === "image" ? 0 : file.size),
          0,
        );

        // 逐个校验后再占用容量，避免一个非法文件挤掉后续合法文件。
        for (const file of incoming) {
          const kind = allowGeneratedText
            ? "text"
            : acceptsFile(file, imageAccept)
              ? "image"
              : "file";
          const acceptedByType =
            kind === "text" ||
            (kind === "image" ? acceptsFile(file, imageAccept) : acceptsFile(file, fileAccept));
          if (!acceptedByType) {
            onError?.({
              code: "invalid_file_type",
              message: t("agentComponents.invalidFileType", { name: file.name }),
            });
            continue;
          }
          if (kind !== "image" && file.size > maxFileSize) {
            onError?.({
              code: "file_too_large",
              message: t("agentComponents.fileTooLarge", { name: file.name }),
            });
            continue;
          }
          if (kind === "image" && file.size > maxImageSize) {
            onError?.({
              code: "file_too_large",
              message: t("agentComponents.fileTooLarge", { name: file.name }),
            });
            continue;
          }
          if (kind === "image" && imageCount >= maxImages) {
            onError?.({
              code: "too_many_images",
              message: t("agentComponents.tooManyImages", { count: maxImages }),
            });
            continue;
          }
          if (kind === "image" && imageBytes + file.size > maxImageTotalSize) {
            onError?.({
              code: "total_size_exceeded",
              message: t("agentComponents.totalImageSizeExceeded"),
            });
            continue;
          }
          if (kind !== "image" && fileBytes + file.size > maxFileTotalSize) {
            onError?.({
              code: "total_size_exceeded",
              message: t("agentComponents.totalAttachmentSizeExceeded"),
            });
            continue;
          }
          accepted.push({
            file,
            id: createUuid(),
            kind,
            mediaType: file.type,
            name: file.name,
            previewUrl: URL.createObjectURL(file),
            size: file.size,
            source: "browser",
          });
          if (kind === "image") {
            imageCount += 1;
            imageBytes += file.size;
          } else {
            fileBytes += file.size;
          }
          if (!multiple) {
            break;
          }
        }
        return [...current, ...accepted];
      });
    },
    [
      disabled,
      fileAccept,
      imageAccept,
      maxFileSize,
      maxFileTotalSize,
      maxImageSize,
      maxImages,
      maxImageTotalSize,
      multiple,
      onError,
      t,
      updateFiles,
    ],
  );

  const clear = useCallback(() => {
    updateFiles((current) => {
      current.forEach(revokePreview);
      return [];
    });
  }, [updateFiles]);

  useLayoutEffect(() => {
    if (previousResetKeyRef.current === resetKey) {
      return;
    }
    previousResetKeyRef.current = resetKey;
    // 外层业务作用域变化时清空附件，但保留表单和编辑器 DOM，避免中断原生输入法上下文。
    if (attachments === undefined) {
      clear();
    }
  }, [attachments, clear, resetKey]);

  const remove = useCallback(
    (id: string) => {
      updateFiles((current) => {
        const removed = current.find((file) => file.id === id);
        if (removed !== undefined) {
          revokePreview(removed);
        }
        return current.filter((file) => file.id !== id);
      });
    },
    [updateFiles],
  );

  useEffect(
    () => () => {
      if (!controlledRef.current) {
        filesRef.current.forEach(revokePreview);
      }
    },
    [],
  );

  useEffect(() => {
    if (attachments === undefined) {
      onAttachmentsChange?.(internalFiles);
    }
  }, [attachments, internalFiles, onAttachmentsChange]);

  useEffect(() => {
    if (!globalDrop || disabled) {
      return undefined;
    }
    const prevent = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files") === true) {
        event.preventDefault();
      }
    };
    const drop = (event: DragEvent) => {
      if (event.dataTransfer?.files.length) {
        event.preventDefault();
        addFiles([...event.dataTransfer.files]);
      }
    };
    document.addEventListener("dragover", prevent);
    document.addEventListener("drop", drop);
    return () => {
      document.removeEventListener("dragover", prevent);
      document.removeEventListener("drop", drop);
    };
  }, [addFiles, disabled, globalDrop]);

  const context = useMemo<PromptInputAttachmentsContextValue>(
    () => ({
      clear,
      disabled,
      files,
      remove,
    }),
    [clear, disabled, files, remove],
  );

  return (
    <PromptInputAttachmentsContext.Provider value={context}>
      <form
        {...props}
        className={`overflow-visible rounded-surface border border-transparent bg-raised shadow-floating transition-[border-color,box-shadow] focus-within:border-brand focus-within:shadow-focus ${className}`}
        data-prompt-input=""
        onPasteCapture={(event) => {
          onPasteCapture?.(event);
          if (disabled || event.defaultPrevented || event.clipboardData.files.length > 0) {
            return;
          }
          const pastedTextFile = createPastedTextFile(
            event.clipboardData.getData("text/plain"),
            largePasteCharacterThreshold,
            pastedTextFileName,
          );
          if (pastedTextFile !== undefined) {
            // capture 阶段先阻止编辑器写入全文，再交给统一附件约束处理。
            event.preventDefault();
            addFiles([pastedTextFile], true);
          }
        }}
        onPaste={(event) => {
          onPaste?.(event);
          if (disabled || event.defaultPrevented) {
            return;
          }
          const pastedFiles = [...event.clipboardData.files];
          if (pastedFiles.length > 0) {
            // 图片由附件预览承载，取消 contenteditable 默认插入，避免正文重复显示。
            event.preventDefault();
            addFiles(pastedFiles);
          }
        }}
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          const value = formData.get("message");
          onSubmit?.({ files, text: typeof value === "string" ? value : "" }, event);
        }}
      >
        {children}
      </form>
    </PromptInputAttachmentsContext.Provider>
  );
}

export * from "./prompt-input-context.js";
export * from "./prompt-input-controls.js";
