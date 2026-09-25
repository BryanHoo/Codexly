import { openExternalUrl } from "../../../platform/tauri/external-url.js";

type MarkdownLinkClick = Readonly<{
  preventDefault: () => void;
}>;

type ExternalUrlOpener = (url: string) => Promise<void>;

function isWebUrl(href: string): boolean {
  try {
    const protocol = new URL(href).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export function openMarkdownLink(
  event: MarkdownLinkClick,
  href: string | undefined,
  openUrl: ExternalUrlOpener = openExternalUrl,
): void {
  if (href === undefined || !isWebUrl(href)) {
    return;
  }

  // WebView 不会自动把新窗口交给系统浏览器，需阻止内置导航并调用原生 opener。
  event.preventDefault();
  void openUrl(href);
}
