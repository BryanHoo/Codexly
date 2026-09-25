import { lazy } from "react";

// 每个分类独立拆包；声明 lazy 不触发下载，只有实际渲染才加载对应模块。
export const GeneralSettingsPanel = lazy(() => import("./general-settings-panel.js").then((module) => ({ default: module.GeneralSettingsPanel })));
export const AgentSettingsPanel = lazy(() => import("./agent-settings-panel.js").then((module) => ({ default: module.AgentSettingsPanel })));
export const CommitSettingsPanel = lazy(() => import("./commit-settings-panel.js").then((module) => ({ default: module.CommitSettingsPanel })));
export const GlobalSettingsAbout = lazy(() => import("./global-settings-about.js").then((module) => ({ default: module.GlobalSettingsAbout })));
export const GlobalSettingsPets = lazy(() => import("../../pets/components/global-settings-pets.js").then((module) => ({ default: module.GlobalSettingsPets })));
export const ProviderConnectionPanel = lazy(() => import("../../provider-connection/components/provider-connection-panel.js").then((module) => ({ default: module.ProviderConnectionPanel })));
export const PersonalizationSettingsPanel = lazy(() => import("./personalization-settings-panel.js").then((module) => ({ default: module.PersonalizationSettingsPanel })));
