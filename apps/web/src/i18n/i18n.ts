import i18next from "i18next";
import { initReactI18next, I18nextProvider, Trans, useTranslation } from "react-i18next";

import {
  applyLanguagePreference,
  readLanguagePreference,
  resolveInitialLanguage,
  saveLanguagePreference,
  type SupportedLanguage,
} from "./language-preference.js";
import { defaultNamespace, namespaces, resources } from "./resources.js";

function getBrowserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

const browserStorage = getBrowserStorage();
const initialLanguage = resolveInitialLanguage(
  browserStorage,
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
  saveLanguagePreference(language, browserStorage ?? { setItem: () => undefined });
  if (typeof document !== "undefined") {
    applyLanguagePreference(language, document.documentElement);
  }
  await i18next.changeLanguage(language);
}

export function getCurrentLanguage(): SupportedLanguage {
  return (
    readLanguagePreference(browserStorage ?? { getItem: () => null }) ??
    (i18next.resolvedLanguage === "en" ? "en" : "zh-CN")
  );
}

export { I18nextProvider, Trans, i18next as i18n, useTranslation };
