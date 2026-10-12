import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";
import { AppProviders } from "./app/providers.js";
import { initializeThemePreference } from "./features/settings/theme-preference.js";
import { initializeAppLanguage } from "./i18n/i18n.js";
import "./shared/styles/globals.css";
import "./shared/styles/task-board.css";
import "./shared/styles/workbench.css";

const rootElement = document.querySelector("#root");

if (!(rootElement instanceof HTMLElement)) {
  throw new Error("Missing #root element");
}

// React 挂载前应用持久主题，避免首帧先使用错误配色。
initializeThemePreference();

// 所选语言准备好后再挂载；默认中文同步资源可直接使用，英语资源独立缓存。
void initializeAppLanguage().then(() => {
  createRoot(rootElement).render(
    <StrictMode>
      <AppProviders>
        <App />
      </AppProviders>
    </StrictMode>,
  );
});
