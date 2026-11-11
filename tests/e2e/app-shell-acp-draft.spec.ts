import { expect, test } from "./fixtures/app-shell.js";
import type { AcpConfigPreviewRequest } from "@codexly/protocol";

for (const width of [390, 1280]) {
  test(`新建 ACP 草稿跳过旧模型查询，刷新后保留配置与首发身份 ${String(width)}px @cross-browser`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => {
      localStorage.setItem(
        "codeagent:engine-setup:v1",
        JSON.stringify({ engines: ["codex"], complete: true }),
      );
    });
    const legacyModels: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/v1/models") legacyModels.push(request.url());
    });
    await page.route("**/v1/capabilities", (route) =>
      route.fulfill({
        json: {
          runtime: "acp",
          provider: "codex",
          feedback: { upload: false },
          goals: { clear: false, read: false, update: false },
          skills: { list: false, use: false },
          tasks: { fork: false, list: true, read: true, start: true },
          turns: { compact: false, interrupt: true, review: false, start: true, steer: false },
        },
      }),
    );
    const previews: unknown[] = [];
    await page.route("**/v1/projects/codexly/acp/codex/preview", (route) => {
      const input = route.request().postDataJSON() as AcpConfigPreviewRequest;
      previews.push(input);
      const enabled = input.change?.value ?? input.values["raw"] ?? false;
      return route.fulfill({
        json: {
          values: { raw: enabled },
          configOptions: [
            { id: "raw", name: "ACP 原始开关", type: "boolean", currentValue: enabled },
          ],
        },
      });
    });
    const submissions: { key: string | undefined; input: Record<string, unknown> }[] = [];
    await page.route("**/v1/projects/codexly/submissions", (route) => {
      submissions.push({
        key: route.request().headers()["idempotency-key"],
        input: route.request().postDataJSON() as Record<string, unknown>,
      });
      return route.fulfill({
        status: 502,
        json: { code: "PROVIDER_ERROR", message: "ACP 尚未发送", retryable: false },
      });
    });
    await page.goto("/p/codexly");
    const editor = page.getByRole("textbox", { name: "任务输入" });
    await editor.fill("保留首发草稿");
    await page.getByRole("button", { name: "输入配置", exact: true }).click();
    await page.getByRole("checkbox", { name: "ACP 原始开关" }).click();
    await expect(page.getByRole("checkbox", { name: "ACP 原始开关" })).toBeChecked();
    await page.getByRole("checkbox", { name: "ACP 原始开关" }).press("Escape");
    await page.getByRole("button", { name: "提交", exact: true }).click();
    await expect.poll(() => submissions.length).toBe(1);
    await expect(editor).toHaveAttribute("data-serialized-value", "保留首发草稿");
    await page.reload();
    await expect(editor).toHaveAttribute("data-serialized-value", "保留首发草稿");
    await page.getByRole("button", { name: "提交", exact: true }).click();
    await expect.poll(() => submissions.length).toBe(2);
    expect(submissions[1]).toEqual(submissions[0]);
    expect(submissions[0]?.input).toMatchObject({
      type: "acp-prompt",
      engine: "codex",
      initialConfig: { raw: true },
      workspacePath: "/workspace/Codexly",
    });
    expect(submissions[0]?.input).not.toHaveProperty("options");
    expect(previews).toContainEqual(
      expect.objectContaining({ values: { raw: true }, workspacePath: "/workspace/Codexly" }),
    );
    expect(legacyModels).toEqual([]);
  });
}
