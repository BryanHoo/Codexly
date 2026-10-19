import type { AgentEngine } from "@codexly/protocol";
import { describe, expect, it, vi } from "vitest";
import { readEngineSetup } from "./engine-setup.js";
import { prepareSelectedEngines, recoverEngineSetup } from "./engine-setup-workflow.js";

describe("first launch engine preparation", () => {
  it("does not prepare Codex when only Claude was selected", async () => {
    const prepare = vi.fn<(engine: AgentEngine) => Promise<void>>().mockResolvedValue(undefined);
    await prepareSelectedEngines(["claude"], prepare);
    expect(prepare.mock.calls.map(([engine]) => engine)).toEqual(["claude"]);
  });
  it("prepares both engines once, and propagates failures for retry", async () => {
    const prepare = vi
      .fn<(engine: AgentEngine) => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("offline"));
    await expect(prepareSelectedEngines(["codex", "claude"], prepare)).rejects.toThrow("offline");
    expect(prepare.mock.calls.map(([engine]) => engine)).toEqual(["codex", "claude"]);
  });
  it("rejects empty choices and safely reads incomplete or malformed saved setup", async () => {
    await expect(prepareSelectedEngines([], vi.fn())).rejects.toThrow();
    expect(readEngineSetup("{broken")).toBeUndefined();
    expect(readEngineSetup('{"engines":[],"complete":true}')).toBeUndefined();
    expect(readEngineSetup('{"engines":["claude"],"complete":false}')).toEqual({
      engines: ["claude"],
      complete: false,
    });
  });
});

describe("setup recovery", () => {
  it("keeps completed setup without probing or resetting it after an update", async () => {
    const probe = vi.fn();
    const saved = { engines: ["claude"] as AgentEngine[], complete: true };
    expect(await recoverEngineSetup(saved, probe)).toEqual(saved);
    expect(probe).not.toHaveBeenCalled();
  });
  it("migrates existing connections when the browser has no setup marker", async () => {
    expect(await recoverEngineSetup(undefined, () => Promise.resolve(["codex", "claude"]))).toEqual(
      {
        engines: ["codex", "claude"],
        complete: true,
      },
    );
  });
  it("only opens first-run setup after a successful empty probe", async () => {
    expect(await recoverEngineSetup(undefined, () => Promise.resolve([]))).toBeUndefined();
    await expect(
      recoverEngineSetup(undefined, () => Promise.reject(new Error("offline"))),
    ).rejects.toThrow("offline");
  });
  it("resumes an unfinished two-engine setup instead of accepting only the first engine", async () => {
    const saved = { engines: ["codex", "claude"] as AgentEngine[], complete: false };
    const probe = vi.fn(() => Promise.resolve(["codex"] as AgentEngine[]));
    expect(await recoverEngineSetup(saved, probe)).toEqual(saved);
    expect(probe).toHaveBeenCalledOnce();
  });
  it("finishes recovery when connection was saved just before the app exited", async () => {
    expect(
      await recoverEngineSetup({ engines: ["claude"], complete: false }, () =>
        Promise.resolve(["claude"]),
      ),
    ).toEqual({ engines: ["claude"], complete: true });
  });
});
