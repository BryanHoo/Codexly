import { synchronizeLanguagePreference } from "../i18n/i18n.js";

export async function prepareAuxiliaryWindow(
  surface: "task-window" | "project-file",
  initializeStorage: () => Promise<void>,
) {
  // 两个 import 必须独立 await：条件表达式会让构建器把小窗 CSS 预加载并入另一分支。
  if (surface === "task-window") {
    const module = await import("../features/task-window/task-window.js");
    return module.prepareTaskWindow();
  }
  const [{ ProjectFileWindowApplication }, { initializeThemePreference }] = await Promise.all([
    import("./project-file-window-application.js"),
    import("../features/settings/theme-preference.js"),
  ]);
  await initializeStorage();
  initializeThemePreference();
  await synchronizeLanguagePreference();
  return ProjectFileWindowApplication;
}
