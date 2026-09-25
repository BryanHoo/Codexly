import { toast } from "sonner";
import { i18n } from "../../i18n/i18n.js";
import { taskWindow as chinese } from "../../i18n/locales/zh-CN/task-window.js";
import { taskWindow as english } from "../../i18n/locales/en/task-window.js";
import { openTaskWindow } from "../../platform/tauri/task-window-client.js";

export async function openTaskWindowFromMenu(projectId: string, taskId: string): Promise<void> {
  try {
    await openTaskWindow(projectId, taskId);
  } catch (error) {
    const limit = typeof error === "object" && error !== null && "code" in error && error.code === "TASK_WINDOW_LIMIT";
    const labels = (i18n.resolvedLanguage ?? i18n.language).startsWith("zh") ? chinese : english;
    toast.error(limit ? labels.limit : i18n.t("taskWindow.failed", { ns: "workbench" }));
  }
}
