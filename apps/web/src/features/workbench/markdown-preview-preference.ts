const MARKDOWN_PREVIEW_STORAGE_KEY = "codexly:workbench:markdown-preview:v1";

type MarkdownPreviewStorage = Readonly<{
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}>;

type MarkdownPreviewPreference = Readonly<{
  preview: boolean;
  version: 1;
}>;

export function getMarkdownPreviewPreferenceStorage(): MarkdownPreviewStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    // 浏览器拒绝访问本地存储时仍保留当前页面的 Markdown 切换能力。
    return undefined;
  }
}

export function readMarkdownPreviewPreference(
  storage: Pick<MarkdownPreviewStorage, "getItem"> | undefined,
): boolean {
  if (storage === undefined) return false;

  try {
    const value: unknown = JSON.parse(storage.getItem(MARKDOWN_PREVIEW_STORAGE_KEY) ?? "null");
    return isMarkdownPreviewPreference(value) ? value.preview : false;
  } catch {
    return false;
  }
}

export function writeMarkdownPreviewPreference(
  preview: boolean,
  storage: Pick<MarkdownPreviewStorage, "setItem"> | undefined,
): void {
  if (storage === undefined) return;

  const preference: MarkdownPreviewPreference = { preview, version: 1 };
  try {
    storage.setItem(MARKDOWN_PREVIEW_STORAGE_KEY, JSON.stringify(preference));
  } catch {
    // 配额不足或隐私模式禁止写入时，不阻断当前页面切换。
  }
}

function isMarkdownPreviewPreference(value: unknown): value is MarkdownPreviewPreference {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as Partial<MarkdownPreviewPreference>;
  return candidate.version === 1 && typeof candidate.preview === "boolean";
}
