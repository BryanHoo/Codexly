import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { applicationPreferencesFromLegacy, type LocalCatalogStore } from "@codexly/core";
import { AcpRuntime } from "./runtime.js";
import { withStorageCatalog } from "./storage-catalog.test-support.js";

it("确认前保持原文件，拒绝过时清单并原子替换启用 Agent 的实际目标", async () => {
  const root = await mkdtemp(join(tmpdir(), "acp-instructions-"));
  const codex = join(root, "codex");
  const claude = join(root, "claude");
  const codexFile = join(codex, "AGENTS.md");
  const target = process.platform === "win32" ? codexFile : join(root, "actual.md");
  const claudeFile = join(claude, "CLAUDE.md");
  const initial = applicationPreferencesFromLegacy(undefined);
  let saved = initial;
  const catalog = vi.fn((operation: string, payload: { changes?: Partial<typeof initial> }) => {
    if (operation === "app.preferences.read") return Promise.resolve(saved);
    if (operation === "app.preferences.patch") {
      saved = { ...saved, ...payload.changes };
      return Promise.resolve(saved);
    }
    return Promise.reject(new Error(operation));
  });
  const runtime = new AcpRuntime(
    root,
    withStorageCatalog({ catalog } as LocalCatalogStore),
    undefined,
    undefined,
    undefined,
    { CODEX_HOME: codex, CLAUDE_CONFIG_DIR: claude },
  );
  try {
    await mkdir(codex);
    await writeFile(target, "旧内容");
    if (target !== codexFile) await symlink(target, codexFile);
    vi.spyOn(runtime.agents.codex, "inspect").mockResolvedValue({
      engine: "codex",
      protocolVersion: 1,
      authMethods: [],
      authStatus: { kind: "account", label: "Codex" },
    });
    vi.spyOn(runtime.agents.claude, "inspect").mockResolvedValue({
      engine: "claude",
      protocolVersion: 1,
      authMethods: [],
      authStatus: { kind: "account", label: "Claude" },
    });
    for (const engine of ["codex", "claude"] as const) {
      const registration = {
        engine,
        name: engine === "codex" ? "Codex" : "Claude",
        command: engine + "-acp",
        args: [],
        enabled: false,
      };
      await runtime.catalog.configure(registration);
      await runtime.catalog.configure({ ...registration, enabled: true });
    }
    const first = await runtime.getAgentInstructionsTargets();
    expect(first.files).toEqual(
      [
        { agents: ["Codex"], path: await realpath(target), exists: true },
        {
          agents: ["Claude"],
          path: join(await realpath(root), "claude", "CLAUDE.md"),
          exists: false,
        },
      ].sort((a, b) => a.path.localeCompare(b.path)),
    );
    expect(await readFile(target, "utf8")).toBe("旧内容");
    await writeFile(target, "外部程序更新");
    await expect(
      runtime.saveAgentInstructions({ content: "当前指令", version: first.version }),
    ).rejects.toThrow("重新确认");
    expect(await readFile(target, "utf8")).toBe("外部程序更新");
    const next = await runtime.getAgentInstructionsTargets();
    expect(
      await runtime.saveAgentInstructions({ content: "当前指令", version: next.version }),
    ).toMatchObject({ globalInstructions: "当前指令" });
    expect(await readFile(join(codex, "AGENTS.md"), "utf8")).toBe("当前指令");
    expect(await readFile(claudeFile, "utf8")).toBe("当前指令");

    const failure = await runtime.getAgentInstructionsTargets();
    catalog.mockImplementation((operation) =>
      operation === "app.preferences.read"
        ? Promise.resolve(saved)
        : Promise.reject(new Error("数据库失败")),
    );
    await expect(
      runtime.saveAgentInstructions({ content: "", version: failure.version }),
    ).rejects.toThrow("数据库失败");
    expect(await readFile(target, "utf8")).toBe("当前指令");
    expect(await readFile(claudeFile, "utf8")).toBe("当前指令");
  } finally {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});
