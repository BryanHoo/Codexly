export const keyboardShortcutChinese = {
  actions: {
    splitUp: "向上分屏",
    splitDown: "向下分屏",
    splitLeft: "向左分屏",
    splitRight: "向右分屏",
    saveFile: "保存文件",
    sendMessage: "发送消息",
    insertNewline: "插入换行",
    promptHistory: "浏览历史输入",
    moveProjectUp: "上移项目",
    moveProjectDown: "下移项目",

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
  sectionDescriptions: {
    general: "常用命令，快速直达",
    view: "按需展开工作台面板",
    workspace: "工作区内生效；保存仅在编辑器内生效。",
    composer: "输入框内生效；历史导航需光标位于首尾",
    navigation: "项目标题聚焦时生效",
  },
  title: "键盘快捷键",
  close: "关闭",
} as const;

export const keyboardShortcutEnglish = {
  actions: {
    splitUp: "Split up",
    splitDown: "Split down",
    splitLeft: "Split left",
    splitRight: "Split right",
    saveFile: "Save file",
    sendMessage: "Send message",
    insertNewline: "Insert newline",
    promptHistory: "Browse prompt history",
    moveProjectUp: "Move project up",
    moveProjectDown: "Move project down",

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
  sectionDescriptions: {
    general: "Your everyday commands",
    view: "Make room for your work",
    workspace: "In the workspace; save applies in the editor.",
    composer: "In the composer; history requires cursor at start/end",
    navigation: "When a project header is focused",
  },
  title: "Keyboard shortcuts",
  close: "Close",
} as const;

export type KeyboardShortcutLabels = Readonly<{
  title: string;
  close: string;
  sectionDescriptions: Readonly<Record<keyof typeof keyboardShortcutEnglish.sections, string>>;
  actions: Readonly<Record<keyof typeof keyboardShortcutEnglish.actions, string>>;
  sections: Readonly<Record<keyof typeof keyboardShortcutEnglish.sections, string>>;
}>;
