import { expect, it, vi } from "vitest";
import { errorDiagnostics } from "./error-diagnostics.js";

it("distinguishes code locations and native types without exposing dynamic error fields", () => {
  const makeError = (line: number) => {
    const error = Object.assign(new Error("secret-body"), {
      name: "secret-name",
      code: "secret-token",
      data: { authorization: "secret-key" },
    });
    error.stack = `secret-message\n    at load (C:\\private\\packages\\server\\src\\loader.ts:${String(line)}:2)`;
    return error;
  };
  const first = errorDiagnostics(makeError(1));
  expect(first).toMatchObject({ errorClass: "Error" });
  expect(first).not.toHaveProperty("systemCode");
  expect(first.errorFingerprint).not.toBe(errorDiagnostics(makeError(2)).errorFingerprint);
  expect(first.errorFingerprint).not.toBe(errorDiagnostics(new TypeError()).errorFingerprint);
  expect(JSON.stringify(first)).not.toMatch(/secret|private|loader/);
});

it("bounds long cause chains, ignores accessors and tolerates hostile exceptions", () => {
  let error = new Error("private");
  for (let index = 0; index < 10; index++) error = new Error("private", { cause: error });
  expect(errorDiagnostics(error).causes).toHaveLength(3);
  const getter = vi.fn(() => {
    throw new Error("secret-getter");
  });
  const opaque = Object.defineProperties(new Error("private"), {
    code: { get: getter },
    cause: { get: getter },
  });
  expect(errorDiagnostics(opaque)).toMatchObject({ causes: [] });
  expect(getter).not.toHaveBeenCalled();
  Object.defineProperty(opaque, "stack", { get: getter });
  const diagnostic = errorDiagnostics(opaque);
  expect(diagnostic).toMatchObject({ errorClass: "Unknown" });
  expect(diagnostic.errorFingerprint).toMatch(/^[a-f0-9]{24}$/);
  expect(JSON.stringify(diagnostic)).not.toMatch(/secret|private/);
});

it("excludes multiline message and name headers from the fingerprint", () => {
  const diagnostic = (message: string, name: string) => {
    const error = Object.assign(new Error(message), { name });
    error.stack = `${name}: ${message}\n    at load (/project/packages/server/src/loader.ts:3:2)`;
    return errorDiagnostics(error);
  };
  const baseline = diagnostic("body", "Error");
  const injected = diagnostic(
    "body\n    at secret (/project/packages/server/src/secret-token.ts:1:1)",
    "Error\n    at secret (/project/packages/server/src/secret-name.ts:1:1)",
  );
  expect(injected.errorFingerprint).toBe(baseline.errorFingerprint);
});
