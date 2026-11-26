import { expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", async () => ({ ...await vi.importActual("@tauri-apps/api/core"), convertFileSrc: (path: string, protocol = "asset") => `${protocol}://localhost/${encodeURIComponent(path)}` }));
import { nativeClient } from "../../features/projects/project-query-contracts.js";

it("实际桌面应用默认公布 ACP 能力，关闭尚无通用协议支持的旧能力", async () => {
  const capabilities = await nativeClient.getCapabilities();
  expect(capabilities.runtime).toBe("acp");
  expect(capabilities.tasks.start).toBe(true);
  expect(capabilities.turns.interrupt).toBe(true);
  expect(capabilities.turns.steer).toBe(false);
  expect(capabilities.skills.use).toBe(false);
  expect(nativeClient.getTaskAttachmentUrl("p", "t", "history-image")).toContain("acp=1");
});
