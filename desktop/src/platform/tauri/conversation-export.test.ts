import { expect, it, vi } from "vitest";
import { saveConversationExport } from "./conversation-export.js";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("./native-invoke.js", () => ({ invoke }));

it("将 JSON 交给原生保存窗口，不从前端指定目标路径", async () => {
  invoke.mockResolvedValueOnce("chosen.json").mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("disk full"));
  const file = { fileName: "conversation.json", content: '{"text":"你好"}' };
  await expect(saveConversationExport(file)).resolves.toBe("chosen.json");
  expect(invoke).toHaveBeenLastCalledWith("save_conversation_export", file);
  await expect(saveConversationExport(file)).resolves.toBeNull();
  await expect(saveConversationExport(file)).rejects.toThrow("disk full");
});
