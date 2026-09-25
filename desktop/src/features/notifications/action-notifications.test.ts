import { afterEach, describe, expect, it } from "vitest";

import { i18n } from "../../i18n/i18n.js";
import { NativeCommandError } from "../../platform/tauri/native-client.js";
import { actionErrorMessage } from "./action-notifications.js";

describe("actionErrorMessage", () => {
  afterEach(async () => {
    await i18n.changeLanguage("zh-CN");
  });

  it.each([
    ["FILE_OPEN_TARGET_UNAVAILABLE", "fileOpenTargetUnavailable"],
    ["FILE_OPEN_APPLICATION_FAILED", "fileOpenApplicationFailed"],
  ] as const)("localizes %s", (code, key) => {
    expect(actionErrorMessage(new NativeCommandError(code, "backend fallback"))).toBe(
      i18n.t(`errors.${key}`, { ns: "common" }),
    );
  });
  it("localizes the missing Git dependency error", () => {
    const error = new NativeCommandError("GIT_NOT_FOUND", "backend fallback");

    expect(actionErrorMessage(error)).toBe(i18n.t("errors.gitNotFound", { ns: "common" }));
  });

  it("localizes attachment size errors", () => {
    const error = new NativeCommandError("ATTACHMENT_TOO_LARGE", "backend fallback");

    expect(actionErrorMessage(error)).toBe(
      i18n.t("errors.attachmentTooLarge", { ns: "common" }),
    );
  });

  it.each([
    ["GIT_LOCAL_CHANGES_OVERWRITTEN", "gitLocalChangesOverwritten"],
    ["GIT_STATUS_TOO_LARGE", "gitStatusTooLarge"],
    ["GIT_COMMAND_FAILED", "gitCommandFailed"],
    ["GIT_OUTPUT_INVALID", "gitCommandFailed"],
    ["GIT_OUTPUT_TOO_LARGE", "gitStatusTooLarge"],
    ["GIT_PATH_ENCODING_UNSUPPORTED", "gitPathEncodingUnsupported"],
    ["GIT_REPOSITORY_UNAVAILABLE", "gitRepositoryUnavailable"],
    ["SNAPSHOT_MISMATCH", "gitSnapshotChanged"],
    ["INVALID_BRANCH", "gitInvalidBranch"],
  ] as const)("localizes %s without replacing diagnostic details", async (code, key) => {
    const diagnostic = "original Git stderr";
    const error = new NativeCommandError(code, diagnostic);
    await i18n.changeLanguage("zh-CN");

    expect([actionErrorMessage(error), error.message]).toEqual([
      i18n.t(`errors.${key}`, { ns: "common" }),
      diagnostic,
    ]);
  });

  it("uses the selected English language for Git guidance", async () => {
    await i18n.changeLanguage("en");

    expect(
      actionErrorMessage(
        new NativeCommandError("GIT_LOCAL_CHANGES_OVERWRITTEN", "original Git stderr"),
      ),
    ).toBe(i18n.t("errors.gitLocalChangesOverwritten", { ns: "common" }));
  });

  it("shows the Codex RPC error message", () => {
    const error = new NativeCommandError(
      "CODEX_RPC_ERROR",
      "invalid value: expected TOML value",
      -32600,
    );

    expect(actionErrorMessage(error)).toBe("invalid value: expected TOML value");
  });
});
