import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { I18nextProvider, i18n, synchronizeLanguagePreference } from "./i18n/i18n.js";
import { initializeAppStorage } from "./platform/tauri/app-storage.js";
import {
  createReactDiagnosticHandlers,
  installGlobalDiagnostics,
  recordApplicationStartFailure,
} from "./platform/tauri/application-diagnostics.js";
import { recordFrontendDiagnostic } from "./platform/tauri/diagnostics.js";
import { installPerformanceMonitoring } from "./shared/performance/performance-monitoring.js";
import { PerformanceProfiler } from "./shared/performance/performance-profiler.js";
import "./shared/styles/globals.css";
import "./shared/styles/task-board.css";
import "./shared/styles/skills-market.css";
import "./shared/styles/workbench.css";
import { prepareWebviewTestBridge } from "./webview-test-bootstrap.js";

const rootElement = document.querySelector("#root");

if (!(rootElement instanceof HTMLElement)) {
  throw new Error("Missing #root element");
}
const applicationRoot = rootElement;
const windowSurface = new URLSearchParams(window.location.search).get("window");
const appSurface =
  windowSurface === "desktop-pet" || windowSurface === "project-file" || windowSurface === "task-window" ? windowSurface : "main";
document.documentElement.dataset.appSurface = appSurface;
installPerformanceMonitoring();
installGlobalDiagnostics();
const reactDiagnosticHandlers = createReactDiagnosticHandlers();

async function initializeAppStorageSafely(): Promise<void> {
  try {
    // 存储故障不应阻断任何窗口启动，本次运行继续使用默认偏好。
    await initializeAppStorage();
  } catch (error) {
    recordFrontendDiagnostic({
      context: {},
      errorMessage: error instanceof Error ? error.message : "App storage initialization failed",
      event: "app_storage_initialization_failed",
      level: "warn",
      stack: error instanceof Error ? (error.stack ?? null) : null,
    });
  }
}

async function startApplication(): Promise<void> {
  await prepareWebviewTestBridge();
  if (appSurface === "project-file" || appSurface === "task-window") {
    const { prepareAuxiliaryWindow } = await import("./app/auxiliary-window-application.js");
    const WindowApplication = await prepareAuxiliaryWindow(appSurface, initializeAppStorageSafely);
    createRoot(applicationRoot, reactDiagnosticHandlers).render(
      <StrictMode>
        <I18nextProvider i18n={i18n}><WindowApplication /></I18nextProvider>
      </StrictMode>,
    );
    return;
  }
  if (appSurface !== "main") {
    const { DesktopPetWindow } = await import(
      "./features/pets/components/desktop-pet-window.js"
    );
    await synchronizeLanguagePreference();
    createRoot(applicationRoot, reactDiagnosticHandlers).render(
      <StrictMode>
        <I18nextProvider i18n={i18n}>
          <DesktopPetWindow />
        </I18nextProvider>
      </StrictMode>,
    );
    return;
  }
  const [{ App }, { AppProviders }, { initializeThemePreference }] = await Promise.all([
    import("./App.js"),
    import("./app/providers.js"),
    import("./features/settings/theme-preference.js"),
  ]);
  await initializeAppStorageSafely();
  initializeThemePreference();
  await synchronizeLanguagePreference();

  // 应用装配集中在唯一入口，避免功能模块直接控制 React 根节点。
  createRoot(applicationRoot, reactDiagnosticHandlers).render(
    <StrictMode>
      <AppProviders>
        <PerformanceProfiler>
          <App />
        </PerformanceProfiler>
      </AppProviders>
    </StrictMode>,
  );
}

void startApplication().catch(recordApplicationStartFailure);
