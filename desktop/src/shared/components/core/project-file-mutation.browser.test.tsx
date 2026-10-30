import "../../styles/globals.css";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { ProjectFileRenameDialog } from "../../../features/workbench/components/project-file-mutation-dialog";

it("重命名只选主名，禁止保留名称，并在失败后保留输入与错误", async () => {
  const { i18n } = await import("../../../i18n/i18n");
  await i18n.changeLanguage("zh-CN");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const rename = vi.fn();
  try {
    flushSync(() => root.render(<ProjectFileRenameDialog initialName="notes.md" targetType="file" isPending={false} onClose={() => undefined} onRename={rename} error={new Error("offline")} />));
    await expect.poll(() => document.querySelector<HTMLInputElement>('input[aria-label="名称"]')).not.toBeNull();
    const input = document.querySelector<HTMLInputElement>('input[aria-label="名称"]')!;
    await expect.poll(() => input.selectionEnd).toBe(5);
    expect(input.selectionStart).toBe(0);
    expect(document.body.textContent).toContain("操作失败");
    await userEvent.fill(input, "CON.txt");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    await userEvent.keyboard("{Enter}");
    expect(rename).not.toHaveBeenCalled();
    await userEvent.fill(input, "新名字.md");
    await userEvent.keyboard("{Enter}");
    expect(rename).toHaveBeenCalledWith("新名字.md");
  } finally { flushSync(() => root.unmount()); host.remove(); }
});

it("删除失败保留错误，默认聚焦取消，提交期间禁止重复操作", async () => {
  const { ProjectFileDeleteDialog } = await import("../../../features/workbench/components/project-file-mutation-dialog");
  const { i18n } = await import("../../../i18n/i18n");
  await i18n.changeLanguage("zh-CN");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const remove = vi.fn();
  const render = (pending: boolean) => root.render(<ProjectFileDeleteDialog name="notes.md" targetType="file" isPending={pending} onClose={() => undefined} onDelete={remove} error={new Error("offline")} />);
  try {
    flushSync(() => render(false));
    await expect.poll(() => document.activeElement?.textContent).toBe("取消");
    expect(document.body.textContent).toContain("操作失败");
    const button = [...document.querySelectorAll("button")].find((node) => node.textContent === "删除")!;
    await userEvent.click(button);
    expect(remove).toHaveBeenCalledTimes(1);
    flushSync(() => render(true));
    expect(button.disabled).toBe(true);
    button.click();
    expect(remove).toHaveBeenCalledTimes(1);
  } finally { flushSync(() => root.unmount()); host.remove(); }
});
