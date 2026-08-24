export const supportedLanguages = ["zh-CN", "en"] as const;

export type SupportedLanguage = (typeof supportedLanguages)[number];

const LANGUAGE_STORAGE_KEY = "code-agent.language-preference";
const LANGUAGE_STORAGE_VERSION = 1;
const DEFAULT_LANGUAGE: SupportedLanguage = "zh-CN";

type LanguageStorageReader = Readonly<{ getItem: (key: string) => string | null }>;
type LanguageStorageWriter = Readonly<{ setItem: (key: string, value: string) => void }>;
interface LanguageRoot {
  lang: string;
}

function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return value === "zh-CN" || value === "en";
}

export function resolveSupportedLanguage(languages: readonly string[]): SupportedLanguage {
  for (const language of languages) {
    const normalizedLanguage = language.toLowerCase();
    if (normalizedLanguage === "en" || normalizedLanguage.startsWith("en-")) {
      return "en";
    }
    if (normalizedLanguage === "zh" || normalizedLanguage.startsWith("zh-")) {
      return "zh-CN";
    }
  }
  return DEFAULT_LANGUAGE;
}

export function readLanguagePreference(storage: LanguageStorageReader): SupportedLanguage | null {
  try {
    const value: unknown = JSON.parse(storage.getItem(LANGUAGE_STORAGE_KEY) ?? "null");
    if (
      typeof value === "object" &&
      value !== null &&
      "version" in value &&
      value.version === LANGUAGE_STORAGE_VERSION &&
      "language" in value &&
      isSupportedLanguage(value.language)
    ) {
      return value.language;
    }
  } catch {
    // 本地偏好损坏或存储不可访问时交由浏览器语言解析，不阻断启动。
  }
  return null;
}

export function saveLanguagePreference(
  language: SupportedLanguage,
  storage: LanguageStorageWriter,
): void {
  try {
    storage.setItem(
      LANGUAGE_STORAGE_KEY,
      JSON.stringify({ language, version: LANGUAGE_STORAGE_VERSION }),
    );
  } catch {
    // 浏览器禁用存储时仍保留当前页面内的语言切换结果。
  }
}

export function applyLanguagePreference(language: SupportedLanguage, root: LanguageRoot): void {
  root.lang = language;
}

export function resolveInitialLanguage(
  storage: LanguageStorageReader | null,
  browserLanguages: readonly string[],
): SupportedLanguage {
  return (
    (storage === null ? null : readLanguagePreference(storage)) ??
    resolveSupportedLanguage(browserLanguages)
  );
}
