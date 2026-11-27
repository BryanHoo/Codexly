import type { SessionUpdate } from "@agentclientprotocol/sdk/unstable";
import { expect, it } from "vitest";
import { runCodefreeTurn } from "./codefree-turn.js";

it.each([true, false])("按协商能力转发当前会话的额度通知（%s）", async (notices) => {
  const sessionId = "ses_current";
  const notification = {
    period: "7D",
    usagePercent: 85,
    used: 8500,
    limit: 10000,
    resetAt: 1800000000,
    eventId: "w",
  };
  const warning = {
    type: "codefree.quota.warning",
    properties: { sessionID: sessionId, notification },
  };
  const events = [
    { ...warning, properties: { ...warning.properties, sessionID: "ses_other" } },
    warning,
    warning,
    {
      type: "codefree.quota.exhausted",
      properties: {
        sessionID: sessionId,
        period: "5H",
        periods: ["5H", "7D"],
        periodDetails: [{ period: "7D", used: 10000, limit: 10000 }],
      },
    },
    { type: "session.idle", properties: { sessionID: sessionId } },
  ];
  const stream = events.map((e) => "data:" + JSON.stringify(e) + "\n\n").join("");
  const server = {
    request: (path: string) => Promise.resolve(new Response(path === "/event" ? stream : null)),
    signal: new AbortController().signal,
  };
  const updates: Extract<SessionUpdate, { sessionUpdate: "notice" }>[] = [];
  const notify = (_method: string, { update }: { update: SessionUpdate }) => {
    if (update.sessionUpdate === "notice") updates.push(update);
    return Promise.resolve();
  };
  await runCodefreeTurn(
    server as unknown as Parameters<typeof runCodefreeTurn>[0],
    "/work",
    { notify } as unknown as Parameters<typeof runCodefreeTurn>[2],
    { sessionId, prompt: [{ type: "text", text: "ok" }] },
    "codefree/model",
    "build",
    { cancel: new AbortController(), admitted: false },
    Promise.resolve([]),
    undefined,
    undefined,
    false,
    false,
    notices,
  );
  expect(updates).toHaveLength(notices ? 2 : 0);
  if (!notices) return;
  const [warningNotice, exhausted] = updates;
  expect(warningNotice?.title).toContain("周");
  expect(warningNotice?.severity).toBe("warning");
  expect(warningNotice?.description).toContain("85%");
  expect(warningNotice?.description).toContain("8,500");
  expect(warningNotice?.description).toContain("2027");
  expect(exhausted?.severity).toBe("error");
  expect(exhausted?.title).toContain("耗尽");
  expect(exhausted?.description).toContain("5 小时");
  expect(exhausted?.description).toContain("周");
});

it.each([
  [
    { quotaStatus: "ACTIVE", sevenDay: { usagePercent: 17.5 }, fiveHour: { usagePercent: 0 } },
    "周额度剩余 82.5%",
  ],
  [
    { quotaStatus: "BYPASSED", statusReason: "OUTSIDE_GRAY_SCOPE", sevenDay: null, fiveHour: null },
    "当前账号未纳入额度灰度范围",
  ],
])("/usage 主动查询账号额度", async (snapshot, expected) => {
  const updates: string[] = [];
  const server = {
    json: (path: string) => {
      expect(path).toBe("/api/aebackend/quota/v1/me");
      return Promise.resolve(snapshot);
    },
  };
  const notify = (_: string, { update }: { update: SessionUpdate }) => {
    if (update.sessionUpdate === "notice") updates.push(update.description ?? "");
    return Promise.resolve();
  };
  const result = await runCodefreeTurn(
    server as unknown as Parameters<typeof runCodefreeTurn>[0],
    "/work",
    { notify } as unknown as Parameters<typeof runCodefreeTurn>[2],
    { sessionId: "ses", prompt: [{ type: "text", text: "/usage" }] },
    "",
    "",
    { cancel: new AbortController(), admitted: false },
    Promise.resolve([]),
    undefined,
    undefined,
    false,
    false,
    true,
  );
  expect(result.stopReason).toBe("end_turn");
  expect(updates.join("")).toContain(expected);
});
