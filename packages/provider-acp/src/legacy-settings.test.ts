import { expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readAcpLegacyApplicationSettings } from "./legacy-settings.js";
it("只读应用旧文件，公共偏好保持原入口，未知智能体值及 false 不丢失", async () => {
  const root = await mkdtemp(join(tmpdir(), "acp-legacy-source-"));
  const codex =
    '{"version":1,"global":{"model":"old","reasoningEffort":"high","fastMode":false,"future":{"enabled":false},"defaultAgent":"claude","defaultModel":"title","pet":{"enabled":false},"commitMessagePrompt":"private"},"projects":{}}\n';
  const claude = '{"loadProjectSettings":false,"future":"unknown"}\n';
  try {
    await mkdir(join(root, "engines/claude"), { recursive: true });
    await writeFile(join(root, "agent-settings.json"), codex);
    await writeFile(join(root, "engines/claude/preferences.json"), claude);
    expect(await readAcpLegacyApplicationSettings(root, "codex")).toEqual({
      policy: "preserve",
      settings: {
        model: "old",
        reasoningEffort: "high",
        fastMode: false,
        future: { enabled: false },
      },
    });
    expect(await readAcpLegacyApplicationSettings(root, "claude")).toEqual({
      policy: "migrate",
      settings: {
        loadProjectSettings: false,
        future: "unknown",
      },
    });
    expect(await readFile(join(root, "agent-settings.json"), "utf8")).toBe(codex);
    expect(await readFile(join(root, "engines/claude/preferences.json"), "utf8")).toBe(claude);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("缺失返回空来源，损坏 / 未知版本 / 超预算拒绝，保留原文件供旧版或修复使用", async () => {
  const root = await mkdtemp(join(tmpdir(), "acp-legacy-invalid-"));
  try {
    expect(await readAcpLegacyApplicationSettings(root, "codex")).toEqual({
      settings: {},
      policy: "preserve",
    });
    for (const text of [
      "{broken",
      "[]",
      '{"version":2,"global":{}}',
      '{"version":1,"global":[]}',
      " ".repeat(512 * 1024 + 1),
    ]) {
      await writeFile(join(root, "agent-settings.json"), text);
      await expect(readAcpLegacyApplicationSettings(root, "codex")).rejects.toThrow();
      expect(await readFile(join(root, "agent-settings.json"), "utf8")).toBe(text);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
