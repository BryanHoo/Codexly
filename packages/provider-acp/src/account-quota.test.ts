import { expect, it } from "vitest";
import { projectQuota, readNativeQuota } from "./account-quota.js";

it("按真实周期解释账号额度，保留耗尽、无限额及缺失值", () => {
  expect(
    projectQuota("codex", {
      rateLimits: {
        primary: { windowDurationMins: 10080, usedPercent: 100 },
        secondary: { windowDurationMins: 300, usedPercent: 1 },
      },
    }),
  ).toMatchObject({ fiveHour: 99, sevenDay: 0 });
  expect(
    projectQuota("claude", {
      rate_limits_available: true,
      rate_limits: { five_hour: { utilization: 12.5 } },
    }),
  ).toMatchObject({ fiveHour: 87.5, sevenDay: null });
  expect(
    projectQuota("acp-github-copilot-cli", {
      quotaSnapshots: {
        chat: { remainingPercentage: 0 },
        completions: { entitlementRequests: -1 },
      },
    }).meters,
  ).toEqual([
    { label: "chat", remaining: 0, unlimited: false },
    { label: "completions", remaining: null, unlimited: true },
  ]);
  expect(
    projectQuota("acp-opencode", {
      data: { go: { monthly: { percent: 63 } }, budgets: [{ id: "team", limit: 50, spent: 5 }] },
    }).meters,
  ).toEqual([
    { label: "monthly", remaining: 37 },
    { label: "team", remaining: 90 },
  ]);
});
it.skipIf(process.env["CODEXLY_QUOTA_LIVE"] !== "1").each(["codex", "claude"] as const)(
  "本机 %s 只读额度控制请求",
  async (engine) => {
    const quota = await readNativeQuota(
      engine,
      { command: engine, args: [] },
      process.env,
      process.cwd(),
    );
    expect(quota).toHaveProperty("sevenDay");
  },
  25000,
);

it("Copilot 使用带 Content-Length 的只读 RPC 接收分块回包", async () => {
  const peer = `process.stdin.once("data",data=>{
    const q=JSON.parse(data.toString().split("\\r\\n\\r\\n")[1]);
    if(q.method!=="account.getQuota")process.exit(2);
    const body=JSON.stringify({jsonrpc:"2.0",id:q.id,result:{quotaSnapshots:{chat:{remainingPercentage:61}}}});
    process.stdout.write("Content-Length: "+Buffer.byteLength(body)+"\\r\\n");
    setTimeout(()=>process.stdout.write("\\r\\n"+body),5);
  })`;
  const quota = await readNativeQuota(
    "acp-github-copilot-cli",
    { command: process.execPath, args: ["-e", peer, "--", "--acp"] },
    process.env,
    process.cwd(),
  );
  expect(quota.meters?.[0]?.remaining).toBe(61);
});
