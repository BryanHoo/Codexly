import { synchronizeLanguagePreference } from "../i18n/i18n.js";

export async function prepareAuxiliaryWindow(
  initializeStorage: () => Promise<void>,
) {
  // 独立文件窗口按需加载，避免主窗口承担预览模块的启动开销。
  const [{ ProjectFileWindowApplication }, { initializeThemePreference }] = await Promise.all([
    import("./project-file-window-application.js"),
    import("../features/settings/theme-preference.js"),
  ]);
  await initializeStorage();
  initializeThemePreference();
  await synchronizeLanguagePreference();
  return ProjectFileWindowApplication;
}
