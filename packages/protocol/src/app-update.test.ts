import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import {
  AppInfoResponseSchema,
  InstallAppUpdateRequestSchema,
  InstallAppUpdateResponseSchema,
} from "./app-update.js";

describe("app update protocol", () => {
  it("strictly validates application information", () => {
    expect(
      Value.Check(AppInfoResponseSchema, {
        appVersion: "1.3.0",
        codexVersion: "0.149.0",
        latestVersion: "1.4.0",
        releaseNotes: "### 新增\n\n- 添加更新日志。",
        status: "available",
        updateAvailable: true,
      }),
    ).toBe(true);
    expect(
      Value.Check(AppInfoResponseSchema, {
        appVersion: "1.3.0",
        codexVersion: "0.149.0",
        latestVersion: null,
        releaseNotes: null,
        status: "check-failed",
        updateAvailable: false,
      }),
    ).toBe(true);
    expect(
      Value.Check(AppInfoResponseSchema, {
        appVersion: "1.3.0",
        codexVersion: "0.149.0",
        extra: true,
        latestVersion: "1.4.0",
        releaseNotes: "### 新增\n\n- 添加更新日志。",
        status: "available",
        updateAvailable: true,
      }),
    ).toBe(false);
    expect(
      Value.Check(AppInfoResponseSchema, {
        appVersion: "1.3.0",
        codexVersion: "0.149.0",
        latestVersion: "1.4.0",
        status: "available",
        updateAvailable: true,
      }),
    ).toBe(false);
  });

  it("accepts only strict semantic versions for update installation", () => {
    expect(Value.Check(InstallAppUpdateRequestSchema, { version: "1.4.0" })).toBe(true);
    expect(Value.Check(InstallAppUpdateRequestSchema, { version: "latest" })).toBe(false);
    expect(Value.Check(InstallAppUpdateRequestSchema, { version: "1.4.0-beta.01" })).toBe(false);
    expect(
      Value.Check(InstallAppUpdateResponseSchema, {
        appVersion: "1.3.0",
        codexVersion: "0.149.0",
        latestVersion: "1.4.0",
        releaseNotes: null,
        status: "restart-required",
        updateAvailable: false,
      }),
    ).toBe(true);
    expect(
      Value.Check(InstallAppUpdateResponseSchema, {
        appVersion: "1.3.0",
        codexVersion: "0.149.0",
        latestVersion: "1.4.0",
        status: "restart-required",
        updateAvailable: false,
      }),
    ).toBe(false);
  });
});
