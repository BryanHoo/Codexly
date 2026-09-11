import { describe, expect, it, vi } from "vitest";
import { CodexlyClient } from "./http-client.js";

describe("personalization client", () => {
  it("保存指令时发送原文基线，并保留冲突错误码", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: "GLOBAL_INSTRUCTIONS_CHANGED",
          message: "changed",
          retryable: false,
        }),
        { status: 409 },
      ),
    );
    const client = new CodexlyClient({ baseUrl: "http://localhost:3000", fetch: fetcher });
    await expect(
      client.saveGlobalInstructions("new", "original", { idempotencyKey: "save-instructions" }),
    ).rejects.toMatchObject({ code: "GLOBAL_INSTRUCTIONS_CHANGED" });
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "http://localhost:3000/v1/personalization/instructions",
    );
    expect(fetcher.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({ content: "new", expectedContent: "original" }),
    );
  });
});
