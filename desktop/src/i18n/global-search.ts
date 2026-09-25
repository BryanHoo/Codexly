import { i18n } from "./i18n.js";
import { globalSearch as en } from "./locales/en/global-search.js";
import { globalSearch as zhCN } from "./locales/zh-CN/global-search.js";

// 搜索文案仅随弹窗或历史定位视图加载，不增加首屏资源与辅助窗口体积。
i18n.addResourceBundle("en", "workbench", { globalSearch: en }, true);
i18n.addResourceBundle("zh-CN", "workbench", { globalSearch: zhCN }, true);
