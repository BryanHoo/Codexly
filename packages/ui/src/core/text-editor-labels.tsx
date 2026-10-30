import type { TextFileEditorLabels } from "@codexly/frontend-core/text-file-editor";

// 编辑命令与差异说明仅随编辑器下载，不进入应用首屏的通用翻译资源。
export type TextEditorLabels = TextFileEditorLabels &
  Readonly<{
    save: string;
    saving: string;
    clean: string;
    dirty: string;
    failed: string;
    conflicted: string;
    saveHint: string;
    find: string;
    toolbar: string;
    history: string;
    view: string;
    undo: string;
    redo: string;
    wrap: string;
    goToLine: string;
    position: string;
    plainLanguage: string;
    disk: string;
    draft: string;
    compareDescription: string;
    conflictTitle: string;
    reloadDisk: string;
    replaceDisk: string;
    confirmReload: string;
    confirmReplace: string;
    confirm: string;
    cancel: string;
    close: string;
    compareError: string;
    staleComparison: string;
    phrases: Readonly<Record<string, string>>;
  }>;
const chinese = {
  conflictTitle: "保存冲突",
  save: "保存",
  saving: "正在保存…",
  clean: "已保存",
  dirty: "未保存",
  failed: "保存失败",
  conflicted: "磁盘内容已变更",
  saveHint: "使用保存按钮或 ⌘/Ctrl+S 保存",
  find: "查找与替换",
  toolbar: "文件编辑工具栏",
  history: "编辑历史",
  view: "查找与显示",
  undo: "撤销",
  redo: "重做",
  wrap: "自动换行",
  goToLine: "跳转到行",
  position: "行 $1，列 $2",
  plainLanguage: "纯文本",
  disk: "磁盘版本（删除标记）",
  draft: "当前草稿（新增标记）",
  compareDescription: "比较当前草稿与磁盘快照。返回编辑可手动合并；采用任一版本前需要确认。",
  reloadDisk: "使用磁盘版本",
  replaceDisk: "用当前草稿保存",
  confirmReload: "确认放弃草稿并载入磁盘快照？此操作无法撤销。",
  confirmReplace: "确认用当前草稿替换已比较的磁盘版本？磁盘再次变化时将停止保存。",
  confirm: "确认",
  cancel: "取消",
  close: "关闭",
  compareError: "无法读取磁盘内容，请检查连接或文件是否仍存在。草稿已保留。",
  staleComparison: "内容已变化，请关闭后重新比较。草稿已保留。",
  phrases: {
    Find: "查找",
    Replace: "替换",
    next: "下一个",
    previous: "上一个",
    all: "选择全部",
    "match case": "区分大小写",
    "by word": "整词匹配",
    regexp: "正则表达式",
    replace: "替换",
    "replace all": "全部替换",
    close: "关闭",
    "Go to line": "跳转到行",
    go: "跳转",
    "Fold line": "折叠行",
    "Unfold line": "展开行",
    unfold: "展开",
    "folded code": "已折叠代码",
    "$1 more lines": "其余 $1 行",
    "$ unchanged lines": "$ 行未更改",
    "current match": "当前匹配",
    "on line": "所在行",
    "replaced match on line $": "已替换第 $ 行的匹配",
    "replaced $ matches": "已替换 $ 处匹配",
  },
};
const english = {
  conflictTitle: "Save conflict",
  save: "Save",
  saving: "Saving…",
  clean: "Saved",
  dirty: "Unsaved",
  failed: "Save failed",
  conflicted: "File changed on disk",
  saveHint: "Save with the button or ⌘/Ctrl+S",
  find: "Find and replace",
  toolbar: "File editing toolbar",
  history: "Edit history",
  view: "Search and display",
  undo: "Undo",
  redo: "Redo",
  wrap: "Word wrap",
  goToLine: "Go to line",
  position: "Ln $1, Col $2",
  plainLanguage: "Plain text",
  disk: "Disk version (deletions)",
  draft: "Your draft (additions)",
  compareDescription:
    "Compare your draft with the disk snapshot. Return to editing to merge manually; confirm before choosing either version.",
  reloadDisk: "Use disk version",
  replaceDisk: "Save current draft",
  confirmReload: "Discard your draft and load the disk snapshot? This cannot be undone.",
  confirmReplace:
    "Replace the compared disk version with your draft? Saving will stop if the disk changes again.",
  confirm: "Confirm",
  cancel: "Cancel",
  close: "Close",
  compareError:
    "Could not read the file on disk. Check the connection and whether it still exists. Your draft is retained.",
  staleComparison: "The content changed. Close and compare again. Your draft is retained.",
  phrases: {},
};
const cache = new WeakMap<TextFileEditorLabels, TextEditorLabels>();
export function getTextEditorLabels(base: TextFileEditorLabels): TextEditorLabels {
  let labels = cache.get(base);
  if (!labels) {
    labels = { ...base, ...(base.language === "en" ? english : chinese) };
    cache.set(base, labels);
  }
  return labels;
}
