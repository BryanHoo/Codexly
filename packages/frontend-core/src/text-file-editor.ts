import type {
  ProjectTextFile,
  SaveProjectTextFileRequest,
  SaveProjectTextFileResponse,
} from "@codexly/protocol";
export type { ProjectTextFile, SaveProjectTextFileRequest, SaveProjectTextFileResponse };
export type TextFileEditorLabels = Readonly<{
  saved: string;
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
}>;
export const textFileEditorChinese: TextFileEditorLabels = {
  saved: "文件已保存",
  loadError: "暂时无法加载编辑器，当前以只读方式显示。你仍可查看和复制内容，请检查连接后重试编辑。",
  saveError: "自动保存失败，修改已保留。再次离开编辑区域或按 ⌘/Ctrl+S 重试。",
  conflict:
    "文件已被其他程序修改，自动保存失败。当前草稿已保留，请复制当前修改，并与磁盘内容核对后处理冲突。",
  inputLimit:
    "本次输入会使文件超过 2 MiB，因此未应用。原有内容未变，你仍可继续编辑；请减少粘贴内容或先删除部分文字。",
  capacity:
    "为保护已有未保存内容，暂时无法打开更多文件进行编辑。当前文件以只读方式显示，仍可查看和复制。请先保存或处理其他文件的草稿，或关闭已保存的编辑文件，再重试编辑。",
  unsupported:
    "当前仅支持不超过 2 MiB 的 UTF-8 文本。此文件暂时以只读方式显示，你仍可查看和复制内容。",
  plainText:
    "文件较大，为保持编辑流畅，已暂停语法高亮。你仍可正常编辑和保存；减少内容后会自动恢复高亮。",
  retryEdit: "重试编辑",
  retrySave: "重试保存",
  retrying: "正在重试…",
  dismiss: "知道了",
};
export const textFileEditorEnglish: TextFileEditorLabels = {
  saved: "saved",
  loadError:
    "The editor could not load. This file is shown read-only, so you can still view and copy it. Check your connection and retry editing.",
  saveError:
    "Auto-save failed. Your edits are retained. Leave the editor again or press ⌘/Ctrl+S to retry.",
  conflict:
    "Another program changed this file. Auto-save failed and your draft is retained. Copy your edits and compare them with the file on disk to resolve the conflict.",
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
};
