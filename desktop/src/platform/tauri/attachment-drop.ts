import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview, type DragDropEvent } from "@tauri-apps/api/webview";
import { AGENT_IMAGE_ACCEPT, type AgentAttachmentUploadResponse } from "@codexly/protocol";
import type { NativeAttachmentDrop } from "@codexly/ui/agent/prompt-input";
import { buildNativeAssetUrl } from "../native-asset-url.js";

type Listener = Parameters<NativeAttachmentDrop["subscribe"]>[0];
const listeners = new Set<Listener>();
let registration: Promise<() => void> | undefined;

async function subscribe(listener: Listener): Promise<() => void> {
  // 普通浏览器预览不注册原生事件，也不引入额外轮询。
  if (!isTauri()) return () => undefined;
  listeners.add(listener);
  registration ??= getCurrentWebview().onDragDropEvent(({ payload }: { payload: DragDropEvent }) => {
    const event = payload.type === "leave"
      ? { type: "leave" as const }
      : {
          type: payload.type,
          // Tauri 返回物理像素；DOM 命中测试使用 CSS 像素，需兼容高 DPI 与窗口缩放。
          x: payload.position.x / window.devicePixelRatio,
          y: payload.position.y / window.devicePixelRatio,
          paths: "paths" in payload ? payload.paths : [],
        };
    for (const receive of listeners) receive(event);
  });
  try {
    const unlisten = await registration;
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) { unlisten(); registration = undefined; }
    };
  } catch (error) {
    listeners.delete(listener);
    if (listeners.size === 0) registration = undefined;
    throw error;
  }
}

export function createNativeAttachmentDrop(
  client: { importHostAttachment: (projectId: string, kind: "file" | "image", path: string) => Promise<AgentAttachmentUploadResponse> },
  projectId: string,
): NativeAttachmentDrop {
  return {
    subscribe,
    async importPath(path) {
      // 只判断文件名扩展名；类型与大小由既有原生接口读取元数据并验证。
      const kind = AGENT_IMAGE_ACCEPT.split(",").some((extension) => path.toLowerCase().endsWith(extension)) ? "image" : "file";
      const { attachment } = await client.importHostAttachment(projectId, kind, path);
      const value = { ...attachment, ...(attachment.kind === "image" ? { detail: "auto" as const } : {}) };
      return { ...value, attachment: value, source: "host", previewUrl: value.kind === "image" ? buildNativeAssetUrl(value.id) : "" };
    },
  };
}
