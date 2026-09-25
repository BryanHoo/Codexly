import { i18n } from "./i18n.js";

// 页面说明随宠物设置加载，不增加工作台首屏的语言资源。
i18n.addResourceBundle("zh-CN", "settings", { petPage: {
  on: "已开启", off: "已关闭", onHint: "在桌面显示宠物与任务动态",
  offHint: "宠物已隐藏，保留当前选择",
  selectionHint: "选择后自动保存", selected: "已选择", empty: "暂无可用宠物，请刷新列表。",
} }, true);
i18n.addResourceBundle("en", "settings", { petPage: {
  on: "On", off: "Off", onHint: "Show your pet and task activity on the desktop",
  offHint: "Pet hidden. Your selection is kept.",
  selectionHint: "Selection saves automatically", selected: "Selected", empty: "No pets available. Refresh the list to try again.",
} }, true);
