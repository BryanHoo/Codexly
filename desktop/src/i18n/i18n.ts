import i18next from "i18next";
import { initReactI18next, I18nextProvider, Trans, useTranslation } from "react-i18next";
import { createDeferredLanguageBackend, createDeferredLanguageLoader } from "@codexly/frontend-core/deferred-language";
import { appPreferenceStorage } from "../platform/tauri/app-storage.js";

import {
  applyLanguagePreference,
  readLanguagePreference,
  resolveInitialLanguage,
  saveLanguagePreference,
  type SupportedLanguage,
} from "./language-preference.js";
import { defaultNamespace, namespaces, resources } from "./resources.js";

const initialLanguage = resolveInitialLanguage(
  appPreferenceStorage,
  typeof window === "undefined" || typeof navigator === "undefined" ? [] : navigator.languages,
);
const ensureLanguage = createDeferredLanguageLoader(
  async () => (await import("./resources-en.js")).englishResources,
  (language, namespace, values) => { i18next.addResourceBundle(language, namespace, values, true); },
);

void i18next.use(createDeferredLanguageBackend(ensureLanguage, (language, namespace) =>
  i18next.getResourceBundle(language, namespace),
)).use(initReactI18next).init({
  defaultNS: defaultNamespace,
  fallbackLng: "zh-CN",
  initAsync: false,
  interpolation: {
    // React 会转义插值后的文本，避免在 i18next 层重复转义。
    escapeValue: false,
  },
  lng: initialLanguage,
  ns: namespaces,
  resources,
  partialBundledLanguages: true,
  supportedLngs: ["zh-CN", "en"],
});

if (typeof document !== "undefined") {
  applyLanguagePreference(initialLanguage, document.documentElement);
}

export async function changeAppLanguage(language: SupportedLanguage): Promise<void> {
  saveLanguagePreference(language, appPreferenceStorage);
  if (typeof document !== "undefined") {
    applyLanguagePreference(language, document.documentElement);
  }
  await i18next.changeLanguage(language);
}

export function getCurrentLanguage(): SupportedLanguage {
  return (
    readLanguagePreference(appPreferenceStorage) ??
    (i18next.resolvedLanguage === "en" ? "en" : "zh-CN")
  );
}

export async function synchronizeLanguagePreference(): Promise<void> {
  const language = resolveInitialLanguage(
    appPreferenceStorage,
    typeof navigator === "undefined" ? [] : navigator.languages,
  );
  // 原生偏好恢复后才确定语言，辅助窗口和主窗口共用同一延迟加载入口。
  if (typeof document !== "undefined") {
    applyLanguagePreference(language, document.documentElement);
  }
  await i18next.changeLanguage(language);
}

export { I18nextProvider, Trans, i18next as i18n, useTranslation };
