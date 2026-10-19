import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import {
  AppInfoResponseSchema,
  AppUpdateProgressResponseSchema,
  InstallAppUpdateRequestSchema,
  InstallAppUpdateResponseSchema,
} from "./app-update.js";

describe("app update protocol", () => {
  it("strictly validates application update progress", () => {
    expect(
      Value.Check(AppUpdateProgressResponseSchema, {
        progress: { percent: 30, phase: "downloading" },
      }),
    ).toBe(true);
    expect(Value.Check(AppUpdateProgressResponseSchema, { progress: null })).toBe(true);
    expect(
      Value.Check(AppUpdateProgressResponseSchema, {
        progress: { percent: 101, phase: "downloading" },
      }),
    ).toBe(false);
    expect(
      Value.Check(AppUpdateProgressResponseSchema, {
        progress: { percent: 30, phase: "unknown" },
      }),
    ).toBe(false);
  });

  it("strictly validates application information", () => {
    expect(
      Value.Check(AppInfoResponseSchema, {
        appVersion: "1.3.0",
        codexVersion: "0.163.0",
        latestVersion: "1.4.0",
        releaseNotes: "### 新增\n\n- 添加更新日志。",
        status: "available",
        updateAvailable: true,
      }),
    ).toBe(true);
    expect(
      Value.Check(AppInfoResponseSchema, {
        appVersion: "1.3.0",
        codexVersion: "0.163.0",
        latestVersion: null,
        releaseNotes: null,
        status: "check-failed",
        updateAvailable: false,
      }),
    ).toBe(true);
    expect(
      Value.Check(AppInfoResponseSchema, {
        appVersion: "1.3.0",
        codexVersion: "0.163.0",
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
        codexVersion: "0.163.0",
        latestVersion: "1.4.0",
        status: "available",
        updateAvailable: true,
      }),
    ).toBe(false);
  });

  it.each([undefined, null, "2.1.300", "2.1.300-beta.1+build.2"])(
    "accepts Claude version %s in information and installation responses",
    (claudeVersion) => {
      const versions = {
        appVersion: "1.3.0",
        codexVersion: "0.163.0",
        ...(claudeVersion === undefined ? {} : { claudeVersion }),
        latestVersion: "1.4.0",
        releaseNotes: null,
        updateAvailable: false,
      };
      expect(Value.Check(AppInfoResponseSchema, { ...versions, status: "current" })).toBe(true);
      expect(
        Value.Check(InstallAppUpdateResponseSchema, { ...versions, status: "restart-required" }),
      ).toBe(true);
    },
  );

  it.each(["", "latest", "0.3", "2.1.300-beta.01", 300])(
    "rejects malformed Claude version %s in both responses",
    (claudeVersion) => {
      const versions = {
        appVersion: "1.3.0",
        codexVersion: "0.163.0",
        claudeVersion,
        latestVersion: "1.4.0",
        releaseNotes: null,
        updateAvailable: false,
      };
      expect(Value.Check(AppInfoResponseSchema, { ...versions, status: "current" })).toBe(false);
      expect(
        Value.Check(InstallAppUpdateResponseSchema, { ...versions, status: "restart-required" }),
      ).toBe(false);
    },
  );

  it("accepts only strict semantic versions for update installation", () => {
    expect(Value.Check(InstallAppUpdateRequestSchema, { version: "1.4.0" })).toBe(true);
    expect(Value.Check(InstallAppUpdateRequestSchema, { version: "latest" })).toBe(false);
    expect(Value.Check(InstallAppUpdateRequestSchema, { version: "1.4.0-beta.01" })).toBe(false);
    expect(
      Value.Check(InstallAppUpdateResponseSchema, {
        appVersion: "1.3.0",
        codexVersion: "0.163.0",
        latestVersion: "1.4.0",
        releaseNotes: null,
        status: "restart-required",
        updateAvailable: false,
      }),
    ).toBe(true);
    expect(
      Value.Check(InstallAppUpdateResponseSchema, {
        appVersion: "1.3.0",
        codexVersion: "0.163.0",
        latestVersion: "1.4.0",
        status: "restart-required",
        updateAvailable: false,
      }),
    ).toBe(false);
  });
});
