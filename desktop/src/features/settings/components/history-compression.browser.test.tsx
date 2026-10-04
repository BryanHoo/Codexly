import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { HistoryCompression } from "@codexly/ui/core/history-compression";

const labels = { title: "历史存储", description: "压缩本机冷历史", compatibility: "其他客户端须支持压缩历史", action: "压缩历史文件", pending: "正在提交…", scheduled: "已提交后台压缩请求；不表示压缩已完成。", failed: "提交失败，请重试。" };
it("only submits on demand, prevents double submission and reports scheduling", async () => {
  let resolve!: (value: { status: "scheduled" }) => void;
  const pending = { promise: new Promise<{ status: "scheduled" }>((done) => { resolve = done; }), resolve: (value: { status: "scheduled" }) => resolve(value) };
  const compressHistory = vi.fn(() => pending.promise);
  await render(<HistoryCompression client={{ compressHistory }} labels={labels} />);
  expect(compressHistory).not.toHaveBeenCalled();
  await page.getByRole("button", { name: labels.action }).click();
  await expect.element(page.getByRole("button", { name: labels.pending })).toBeDisabled();
  pending.resolve({ status: "scheduled" });
  await expect.element(page.getByRole("status")).toHaveTextContent(labels.scheduled);
  await expect.element(page.getByRole("button", { name: labels.action })).toBeEnabled();
  expect(compressHistory).toHaveBeenCalledTimes(1);
});
it("shows failure and permits retry", async () => {
  const compressHistory = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ status: "scheduled" });
  await render(<HistoryCompression client={{ compressHistory }} labels={labels} />);
  await page.getByRole("button", { name: labels.action }).click();
  await expect.element(page.getByRole("alert")).toHaveTextContent(labels.failed);
  await page.getByRole("button", { name: labels.action }).click();
  await expect.element(page.getByRole("status")).toHaveTextContent(labels.scheduled);
});
