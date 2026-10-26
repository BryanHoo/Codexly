import { expect, it, vi } from "vitest";
import { saveCodexDiagnostics } from "./feedback-save.js";
import { RpcResponseError } from "./jsonl-rpc-client.js";

it("saves locally using a new absolute ZIP path without uploading feedback", async () => {
  const request = vi
    .fn()
    .mockResolvedValue({ savedPath: "/tmp/report.zip", threadId: "", promptHash: null });
  await saveCodexDiagnostics({ request }, "/tmp/report.zip");
  expect(request).toHaveBeenCalledExactlyOnceWith(
    "feedback/save",
    {
      savePath: "/tmp/report.zip",
      classification: "bug",
      includeLogs: true,
    },
    120_000,
  );
});

it("rejects foreign response paths and malformed envelopes", async () => {
  const request = vi
    .fn()
    .mockResolvedValue({ savedPath: "/private/file.zip", threadId: "", promptHash: null });
  await expect(saveCodexDiagnostics({ request }, "/tmp/report.zip")).rejects.toThrow();
  request.mockResolvedValue({ savedPath: "/tmp/report.zip" });
  await expect(saveCodexDiagnostics({ request }, "/tmp/report.zip")).rejects.toThrow();
  await expect(saveCodexDiagnostics({ request }, "relative.zip")).rejects.toThrow();
  expect(request).toHaveBeenCalledTimes(2);
});

it("reports unsupported runtimes without calling feedback/upload", async () => {
  const request = vi
    .fn()
    .mockRejectedValue(new RpcResponseError({ code: -32601, message: "unknown", data: null }));
  await expect(saveCodexDiagnostics({ request }, "/tmp/report.zip")).rejects.toThrow("unsupported");
  expect(request).toHaveBeenCalledOnce();
});
