import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";
import { AppProviders } from "./app/providers.js";
import { initializeThemePreference } from "./features/settings/theme-preference.js";
import "./i18n/i18n.js";
import "./shared/styles/globals.css";
import "./shared/styles/workbench.css";

const rootElement = document.querySelector("#root");

if (!(rootElement instanceof HTMLElement)) {
  throw new Error("Missing #root element");
}

// React 挂载前应用持久主题，避免首帧先使用错误配色。
initializeThemePreference();

// 应用装配集中在唯一入口，避免功能模块直接控制 React 根节点。
createRoot(rootElement).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </StrictMode>,
);
