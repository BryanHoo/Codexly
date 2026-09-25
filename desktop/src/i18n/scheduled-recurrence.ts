import { i18n } from "./i18n.js";
import { scheduledRecurrence as en } from "./locales/en/scheduled-recurrence.js";
import { scheduledRecurrence as zhCN } from "./locales/zh-CN/scheduled-recurrence.js";
import { scheduledTasks as baseEn } from "./locales/en/scheduled-tasks.js";
import { scheduledTasks as baseZhCN } from "./locales/zh-CN/scheduled-tasks.js";

// 定时任务随功能路由加载文案，不让自定义重复设置增加首屏和普通工作台载荷。
i18n.addResourceBundle("en", "workbench", { scheduledTasks: { ...baseEn, ...en } }, true);
i18n.addResourceBundle("zh-CN", "workbench", { scheduledTasks: { ...baseZhCN, ...zhCN } }, true);
