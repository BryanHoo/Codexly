import i18next from "i18next";
import { initReactI18next, I18nextProvider, Trans, useTranslation } from "react-i18next";
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

void i18next.use(initReactI18next).init({
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
  if (typeof document !== "undefined") {
    applyLanguagePreference(language, document.documentElement);
  }
  await i18next.changeLanguage(language);
}

export { I18nextProvider, Trans, i18next as i18n, useTranslation };
