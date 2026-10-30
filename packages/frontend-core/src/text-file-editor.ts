import type {
  ProjectTextFile,
  SaveProjectTextFileRequest,
  SaveProjectTextFileResponse,
} from "@codexly/protocol";
export type { ProjectTextFile, SaveProjectTextFileRequest, SaveProjectTextFileResponse };
export type TextFileEditorLabels = Readonly<{
  saved: string;
  language: "zh" | "en";
  compare: string;
  loadError: string;
  saveError: string;
  conflict: string;
  inputLimit: string;
  capacity: string;
  unsupported: string;
  plainText: string;
  retryEdit: string;
  retrySave: string;
  retrying: string;
  dismiss: string;
  discard: string;
  discardConfirm: string;
  confirmDiscard: string;
  keepEditing: string;
}>;
export const textFileEditorChinese: TextFileEditorLabels = {
  language: "zh",
  compare: "比较磁盘内容",
  saved: "文件已保存",
  loadError: "加载失败，当前只读，可查看和复制。请检查连接后重试编辑。",
  saveError: "保存失败，修改已保留。请重试保存或按 ⌘/Ctrl+S。",
  conflict: "磁盘已更新，草稿已保留。请比较内容后处理冲突。",
  inputLimit: "输入会超过 2 MiB，未应用，原文未变。请减少粘贴量后继续编辑。",
  capacity:
    "为保护未保存草稿，编辑容量已满。当前只读，仍可查看和复制；请保存草稿或关闭已保存文件后重试编辑。",
  unsupported: "仅支持 2 MiB 内的 UTF-8 文本。当前只读，可查看和复制。",
  plainText: "大文件已暂停语法高亮，编辑和保存正常；缩小后恢复高亮。",
  retryEdit: "重试编辑",
  retrySave: "重试保存",
  retrying: "正在重试…",
  dismiss: "知道了",
  discard: "放弃修改",
  discardConfirm: "放弃此文件未保存的修改？此操作无法撤销。",
  confirmDiscard: "确认放弃",
  keepEditing: "继续编辑",
};
export const textFileEditorEnglish: TextFileEditorLabels = {
  language: "en",
  compare: "Compare with disk",
  saved: "saved",
  loadError:
    "The editor could not load. This file is shown read-only, so you can still view and copy it. Check your connection and retry editing.",
  saveError: "Saving failed. Your edits are retained. Use Save or press ⌘/Ctrl+S to retry.",
  conflict:
    "Another program changed this file. Your draft is retained. Compare with disk to choose a version, or return to editing to merge your changes.",
  inputLimit:
    "This input would make the file exceed 2 MiB, so it was not applied. Your existing content is unchanged and you can keep editing. Paste less text or remove some content first.",
  capacity:
    "To protect your unsaved edits, no more files can be opened for editing right now. This file is read-only; you can still view and copy it. Save or resolve other drafts, or close saved editors, then retry editing.",
  unsupported:
    "Editing currently supports UTF-8 text files up to 2 MiB. This file is shown read-only, so you can still view and copy its contents.",
  plainText:
    "Syntax highlighting is paused to keep this large file responsive. You can still edit and save normally. Highlighting returns automatically when the content is smaller.",
  retryEdit: "Retry editing",
  retrySave: "Retry saving",
  retrying: "Retrying…",
  dismiss: "Got it",
  discard: "Discard changes",
  discardConfirm:
    "Discard unsaved changes to this file? This cannot be undone. You can close the file afterwards.",
  confirmDiscard: "Confirm discard",
  keepEditing: "Keep editing",
};
