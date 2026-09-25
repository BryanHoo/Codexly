import { openExternalUrl } from "../../platform/tauri/external-url.js";

type ExternalUrlOpener = (url: string) => Promise<void>;

export async function openOfficialAuthUrl(
  authUrl: string,
  openUrl: ExternalUrlOpener = openExternalUrl,
): Promise<void> {
  // 官方认证必须留在系统浏览器，并拒绝可能泄露认证信息的非 HTTPS 地址。
  const url = new URL(authUrl);
  if (url.protocol !== "https:") {
    throw new Error("Official login URL must use HTTPS");
  }

  await openUrl(authUrl);
}
