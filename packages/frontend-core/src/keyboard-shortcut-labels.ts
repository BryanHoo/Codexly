export const keyboardShortcutChinese = {
  actions: {
    splitUp: "向上分屏（工作区内）",
    splitDown: "向下分屏（工作区内）",
    splitLeft: "向左分屏（工作区内）",
    splitRight: "向右分屏（工作区内）",
    saveFile: "保存文件（编辑器内）",
    sendMessage: "发送消息（输入框内）",
    insertNewline: "插入换行（输入框内）",
    promptHistory: "浏览历史输入（光标位于首尾）",
    moveProjectUp: "上移项目（项目标题聚焦时）",
    moveProjectDown: "下移项目（项目标题聚焦时）",

    newTask: "新建任务",
    openSettings: "打开设置",
    searchTasks: "全局搜索",
    showShortcuts: "查看键盘快捷键",
    toggleInspector: "显示或隐藏上下文面板",
    toggleSidebar: "显示或隐藏项目侧栏",
    toggleTerminal: "显示或隐藏终端",
  },
  sections: {
    workspace: "工作区与文件",
    composer: "消息输入",
    navigation: "项目排序",
    general: "常用操作",
    view: "界面",
  },
  title: "键盘快捷键",
  close: "关闭",
} as const;

export const keyboardShortcutEnglish = {
  actions: {
    splitUp: "Split up (workspace)",
    splitDown: "Split down (workspace)",
    splitLeft: "Split left (workspace)",
    splitRight: "Split right (workspace)",
    saveFile: "Save file (editor)",
    sendMessage: "Send message (composer)",
    insertNewline: "Insert newline (composer)",
    promptHistory: "Browse prompt history (cursor at start/end)",
    moveProjectUp: "Move project up (project header focused)",
    moveProjectDown: "Move project down (project header focused)",

    newTask: "New task",
    openSettings: "Open settings",
    searchTasks: "Global search",
    showShortcuts: "View keyboard shortcuts",
    toggleInspector: "Show or hide context panel",
    toggleSidebar: "Show or hide project sidebar",
    toggleTerminal: "Show or hide terminal",
  },
  sections: {
    workspace: "Workspace and files",
    composer: "Composer",
    navigation: "Project ordering",
    general: "General",
    view: "View",
  },
  title: "Keyboard shortcuts",
  close: "Close",
} as const;

export type KeyboardShortcutLabels = Readonly<{
  title: string;
  close: string;
  actions: Readonly<Record<keyof typeof keyboardShortcutEnglish.actions, string>>;
  sections: Readonly<Record<keyof typeof keyboardShortcutEnglish.sections, string>>;
}>;
