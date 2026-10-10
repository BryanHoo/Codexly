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
}>;
export const textFileEditorChinese: TextFileEditorLabels = {
  saved: "文件已保存",
  loadError: "暂时无法编辑此文件，请重新打开后重试。",
  saveError: "自动保存失败，修改已保留。再次离开编辑区域或按 ⌘/Ctrl+S 重试。",
  conflict:
    "文件已被其他程序修改，自动保存失败。当前草稿已保留，请复制当前修改，并与磁盘内容核对后处理冲突。",
};
export const textFileEditorEnglish: TextFileEditorLabels = {
  saved: "saved",
  loadError: "Cannot edit this file right now. Reopen it to try again.",
  saveError:
    "Auto-save failed. Your edits are retained. Leave the editor again or press ⌘/Ctrl+S to retry.",
  conflict:
    "Another program changed this file. Auto-save failed and your draft is retained. Copy your edits and compare them with the file on disk to resolve the conflict.",
};
