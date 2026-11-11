import { expect, it } from "vitest";
import { acpCapabilities } from "./provider-discovery.js";
import { AgentCapabilitiesSchema } from "@codexly/protocol";
import { Value } from "@sinclair/typebox/value";
it.each(["codex", "claude"] as const)(
  "%s 明确公布 ACP 运行时，界面不根据引擎名猜测",
  async (engine) => {
    const capabilities = await acpCapabilities(engine);
    expect(capabilities).toMatchObject({ provider: engine, runtime: "acp" });
    expect(Value.Check(AgentCapabilitiesSchema, capabilities)).toBe(true);
  },
);
