import { expect, test, vi } from "vitest";
import { createInterruptedReplyRecovery } from "./interrupted-replies.js";

const message = (text: string) => ({
  id: "answer",
  type: "message",
  role: "assistant",
  phase: "final_answer",
  text,
});
const turn = (items = [message("已生成的部分结果")]) => ({
  id: "turn",
  status: "interrupted",
  items,
});
const identity = { projectId: "project", taskId: "task" };
function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

test("中断正文跨恢复实例保留，空历史不能覆盖，重复恢复不重复消息", () => {
  const disk = storage();
  createInterruptedReplyRecovery(identity, disk).save(turn());
  const restarted = createInterruptedReplyRecovery(identity, disk);
  const restored = restarted.restore([turn([message("")])]);
  expect(restored[0]?.items).toEqual([message("已生成的部分结果")]);
  expect(restarted.restore(restored)).toEqual(restored);
  expect(restarted.restore([turn([])])[0]?.items).toEqual([message("已生成的部分结果")]);
});

test("只补全相同身份的中断回合，正常完成和其他任务保持权威", () => {
  const disk = storage();
  const recovery = createInterruptedReplyRecovery(identity, disk);
  recovery.save(turn());
  expect(recovery.restore([{ ...turn([]), id: "other" }])[0]?.items).toEqual([]);
  expect(recovery.restore([{ ...turn([]), status: "completed" }])[0]?.items).toEqual([]);
  expect(
    createInterruptedReplyRecovery({ ...identity, taskId: "other" }, disk).restore([turn([])])[0]
      ?.items,
  ).toEqual([]);
  expect(recovery.restore([turn([message("已生成的部分结果以及更多")])])[0]?.items[0]?.text).toBe(
    "已生成的部分结果以及更多",
  );
});

test("正常输出不写存储，损坏存储不阻断历史读取", () => {
  const disk = storage();
  const recovery = createInterruptedReplyRecovery(identity, disk);
  recovery.save({ ...turn(), status: "completed" });
  expect(disk.setItem).not.toHaveBeenCalled();
  expect(
    createInterruptedReplyRecovery(identity, { ...disk, getItem: () => "invalid" }).restore([
      turn([]),
    ])[0],
  ).toEqual(turn([]));
});
