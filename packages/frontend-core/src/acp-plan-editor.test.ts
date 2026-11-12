import { expect, it, vi } from "vitest";
import raw from "../../../tests/fixtures/acp-scheduled-plan-definition.json" with { type: "json" };
import type { AcpPlanView, SaveAcpPlan } from "@codexly/protocol/acp-plan-api";
import { AcpPlanEditorSession, type AcpPlanEditorPorts } from "./acp-plan-editor.js";
import type { AcpScheduledPlanDefinition } from "@codexly/protocol/acp-scheduled-plan";
const definition = raw as AcpScheduledPlanDefinition;
function view(input: SaveAcpPlan): AcpPlanView {
  return {
    source: "web",
    scheduleId: "plan",
    revision: 1,
    definition: input.definition,
    state: { revision: 1, definitionRevision: 1, nextRunAt: null },
    canEdit: true,
    resources: [],
  };
}
it("失败保留草稿和幂等身份，成功更新双修订；重复提交互斥", async () => {
  const save = vi
    .fn<AcpPlanEditorPorts["saveAcpPlan"]>((_: string, input: SaveAcpPlan) =>
      Promise.resolve(view(input)),
    )
    .mockRejectedValueOnce(new Error("network"));
  const session = new AcpPlanEditorSession(
    "plan",
    definition,
    { saveAcpPlan: save, stageAcpPlanAttachment: vi.fn() },
    () => "stable",
  );
  session.update({ ...definition, name: "修改", values: { mode: false } });
  await expect(session.save()).rejects.toThrow("network");
  expect(session.snapshot.definition.name).toBe("修改");
  await session.save();
  expect(save.mock.calls[0]?.[1]).toMatchObject({ expectedRevision: 0, expectedStateRevision: 0 });
  expect(save.mock.calls[0]?.[2].idempotencyKey).toBe(save.mock.calls[1]?.[2].idempotencyKey);
  expect(session.snapshot.view?.state?.revision).toBe(1);
  expect(session.snapshot.dirty).toBe(false);
});
it("关闭后的迟到结果不能接管；冲突和占用保留用户草稿", async () => {
  let finish!: (v: AcpPlanView) => void;
  const save = vi.fn(
    () =>
      new Promise<AcpPlanView>((resolve) => {
        finish = resolve;
      }),
  );
  const session = new AcpPlanEditorSession(
    "plan",
    definition,
    { saveAcpPlan: save, stageAcpPlanAttachment: vi.fn() },
    () => "stable",
  );
  const pending = session.save();
  await expect(session.save()).rejects.toThrow();
  expect(() => {
    session.update({ ...definition, name: "late" });
  }).toThrow();
  session.close();
  finish(view({ definition, resources: [], expectedRevision: 0, expectedStateRevision: 0 }));
  await pending;
  expect(session.snapshot.view).toBeNull();
  expect(session.snapshot.definition).toEqual(definition);
});

it("加载已有计划保留双修订和资源，冲突保留草稿，明确加载才能替换", async () => {
  const stored = view({ definition, resources: [], expectedRevision: 0, expectedStateRevision: 0 });
  stored.state = { revision: 4, definitionRevision: 1, nextRunAt: null };
  const save = vi.fn<AcpPlanEditorPorts["saveAcpPlan"]>().mockRejectedValue(new Error("conflict"));
  const session = AcpPlanEditorSession.edit(stored, {
    saveAcpPlan: save,
    stageAcpPlanAttachment: vi.fn(),
  });
  session.update({ ...definition, name: "未保存" });
  await expect(session.save()).rejects.toThrow("conflict");
  expect(save.mock.calls[0]?.[1]).toMatchObject({ expectedRevision: 1, expectedStateRevision: 4 });
  expect(session.snapshot.definition.name).toBe("未保存");
  expect(session.snapshot.dirty).toBe(true);
  session.load({ ...stored, canEdit: false });
  expect(() => {
    session.update(definition);
  }).toThrow();
  await expect(session.save()).rejects.toThrow();
  expect(session.snapshot.definition.name).toBe(stored.definition.name);
});
it("资源先暂存后绑定完整集合，删除只移除引用，状态快照不可被外部改写", async () => {
  const resource = {
    token: "token",
    attachment: { id: "private-ref", kind: "file" as const, mediaType: "x", name: "a", size: 1 },
    digest: "a".repeat(64),
    written: 1,
    boundRevision: null,
  };
  const stage = vi.fn<AcpPlanEditorPorts["stageAcpPlanAttachment"]>().mockResolvedValue(resource);
  const save = vi.fn<AcpPlanEditorPorts["saveAcpPlan"]>((_id, input) =>
    Promise.resolve({ ...view(input), resources: [{ ...resource, boundRevision: 1 }] }),
  );
  const session = new AcpPlanEditorSession("plan", definition, {
    saveAcpPlan: save,
    stageAcpPlanAttachment: stage,
  });
  await session.stage({ id: "upload", kind: "file", mediaType: "x", name: "a", size: 1 });
  expect(session.snapshot.definition.prompt.attachments).toEqual([{ id: "private-ref" }]);
  expect(stage.mock.calls[0]?.[1]).toBe("p");
  const snapshot = session.snapshot;
  snapshot.definition.name = "injected";
  expect(session.snapshot.definition.name).not.toBe("injected");
  await session.save();
  expect(save.mock.calls[0]?.[1].resources).toEqual(["token"]);
  session.removeAttachment("private-ref");
  expect(session.snapshot.resources).toEqual([]);
  expect(session.snapshot.dirty).toBe(true);
  expect(() => {
    session.update({ ...session.snapshot.definition, projectId: "foreign" });
  }).toThrow();
});

it("关闭后迟到的失败同样失效，不把旧编辑请求错误交给新界面", async () => {
  let reject!: (error: Error) => void;
  const save = vi.fn<AcpPlanEditorPorts["saveAcpPlan"]>(
    () =>
      new Promise((_resolve, no) => {
        reject = no;
      }),
  );
  const session = new AcpPlanEditorSession("plan", definition, {
    saveAcpPlan: save,
    stageAcpPlanAttachment: vi.fn(),
  });
  const pending = session.save();
  session.close();
  reject(new Error("late network error"));
  await expect(pending).resolves.toBeUndefined();
  expect(session.snapshot.view).toBeNull();
  expect(session.snapshot.busy).toBe(false);
});
