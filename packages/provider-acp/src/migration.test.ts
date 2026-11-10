import { describe, expect, it } from "vitest";
import type { SessionConfigOption } from "@agentclientprotocol/sdk/unstable";
import { migrateAcpSettings, bindAcpTask, selectSessionOperation } from "./migration.js";

const options: SessionConfigOption[] = [
  {
    id: "model",
    name: "模型",
    type: "select",
    category: "model",
    currentValue: "default",
    options: [
      { value: "default", name: "默认" },
      { value: "custom-model", name: "自定义" },
    ],
  },
  {
    id: "effort",
    name: "思考",
    type: "select",
    category: "thought_level",
    currentValue: "medium",
    options: [
      { value: "high", name: "高" },
      { value: "medium", name: "中" },
    ],
  },
  {
    id: "mode",
    name: "权限",
    type: "select",
    category: "mode",
    currentValue: "default",
    options: [
      { value: "default", name: "默认" },
      { value: "plan", name: "规划" },
    ],
  },
];

describe("ACP 历史和配置迁移", () => {
  it("保留应用身份、引擎绑定和旧原生会话 ID", () => {
    for (const provider of ["codex", "claude"] as const) {
      expect(
        bindAcpTask({
          id: "application-id",
          provider,
          sessionId: "old-native-id",
          cwd: "/workspace",
        }),
      ).toEqual({
        taskId: "application-id",
        engine: provider,
        sessionId: "old-native-id",
        cwd: "/workspace",
      });
    }
    expect(() =>
      bindAcpTask({ id: "a", provider: "unknown", sessionId: "s", cwd: "/workspace" }),
    ).toThrow("引擎");
  });

  it("只有未绑定任务才新建，旧任务不支持恢复时失败", () => {
    expect(selectSessionOperation(null, {}, true)).toBe("new");
    expect(selectSessionOperation("old", { loadSession: true }, true)).toBe("load");
    expect(
      selectSessionOperation(
        "old",
        { loadSession: true, sessionCapabilities: { resume: {} } },
        false,
      ),
    ).toBe("resume");
    expect(selectSessionOperation("old", { loadSession: true }, false)).toBe("load");
    expect(() => selectSessionOperation("old", {}, true)).toThrow("历史");
    expect(() =>
      selectSessionOperation("old", { sessionCapabilities: { resume: {} } }, true),
    ).toThrow("历史");
  });

  it("按协商值迁移模型和思考，保留未知配置且不修改原对象", () => {
    const legacy = {
      model: "custom-model",
      reasoningEffort: "high",
      instructions: "保留规则",
      vendorFuture: { enabled: true },
    };
    const before = structuredClone(legacy);
    const migrated = migrateAcpSettings(legacy, options);
    expect(migrated.values).toEqual({ model: "custom-model", effort: "high" });
    expect(migrated.legacy).toEqual(before);
    expect(migrated.unmapped).toEqual(["instructions", "vendorFuture"]);
    expect(legacy).toEqual(before);
    expect(migrateAcpSettings(migrated, options)).toEqual(migrated);
  });

  it("不猜测权限等价关系，不将其他配置覆盖成宽松模式", () => {
    const migrated = migrateAcpSettings(
      {
        permissionMode: "bypassPermissions",
        sandboxMode: "workspace-write",
        approvalPolicy: "never",
      },
      options,
    );
    expect(migrated.values).toEqual({});
    expect(migrated.unmapped).toEqual(["permissionMode", "sandboxMode", "approvalPolicy"]);
    expect(migrateAcpSettings({ permissionMode: "plan" }, options).values).toEqual({
      mode: "plan",
    });
  });

  it("支持分组选择和布尔配置，只接受 agent 公布的值", () => {
    const discovered: SessionConfigOption[] = [
      {
        id: "model",
        name: "模型",
        type: "select",
        category: "model",
        currentValue: "a",
        options: [{ group: "official", name: "官方", options: [{ value: "a", name: "A" }] }],
      },
      { id: "fast", name: "加速", type: "boolean", currentValue: false },
    ];
    expect(migrateAcpSettings({ model: "a", fast: true }, discovered).values).toEqual({
      model: "a",
      fast: true,
    });
    expect(migrateAcpSettings({ model: "missing", fast: "true" }, discovered).values).toEqual({});
  });

  it("延迟发现后重新映射尚未迁移的配置，不丢失未来选项", () => {
    const initial = migrateAcpSettings({ model: "custom-model", reasoningEffort: "high" }, []);
    expect(initial.values).toEqual({});
    const retried = migrateAcpSettings(initial, options);
    expect(retried.values).toEqual({ model: "custom-model", effort: "high" });
    expect(retried.unmapped).toEqual([]);
  });

  it("agent 删除旧选项后仍保留用户选择，重新出现时可恢复", () => {
    const migrated = migrateAcpSettings({ model: "custom-model" }, options);
    const unavailable = migrateAcpSettings(migrated, []);
    expect(unavailable.values).toEqual({});
    expect(unavailable.legacy["model"]).toBe("custom-model");
    expect(migrateAcpSettings(unavailable, options).values["model"]).toBe("custom-model");
  });
});
