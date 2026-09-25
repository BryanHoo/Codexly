import { convertFileSrc } from "@tauri-apps/api/core";

export function buildNativeAssetUrl(path: string): string {
  return /^(?:blob:|data:|https?:)/u.test(path) ? path : convertFileSrc(path);
}
