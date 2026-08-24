import { describe, expect, it } from "vitest";

import webConfig, { supportedBrowserTargets } from "./vite.config.js";

describe("Web Vite browser targets", () => {
  it("locks the production build to the supported browser minimums", () => {
    expect(supportedBrowserTargets).toEqual(["chrome116", "firefox124", "safari17.4"]);
    expect(webConfig).toMatchObject({
      build: {
        manifest: true,
        target: ["chrome116", "firefox124", "safari17.4"],
      },
    });
  });

  it("isolates the oversized C++ macro grammar from its parent language chunk", () => {
    expect(webConfig).toMatchObject({
      build: {
        rolldownOptions: {
          output: {
            codeSplitting: {
              groups: [
                {
                  includeDependenciesRecursively: false,
                  name: "grammar-cpp-support",
                },
                {
                  includeDependenciesRecursively: false,
                  name: "react-runtime",
                },
              ],
            },
          },
        },
      },
    });

    const output = webConfig.build?.rolldownOptions?.output;
    const normalizedOutput = Array.isArray(output) ? output[0] : output;
    const codeSplitting = normalizedOutput?.codeSplitting;
    const grammarPattern =
      typeof codeSplitting === "object" ? codeSplitting.groups?.[0]?.test : undefined;
    expect(grammarPattern).toBeInstanceOf(RegExp);
    if (!(grammarPattern instanceof RegExp)) throw new TypeError("missing Grammar chunk pattern");
    expect(grammarPattern.test("/@shikijs/langs/dist/cpp-macro.mjs")).toBe(true);
    expect(grammarPattern.test("C:\\@shikijs\\langs\\dist\\regexp.mjs")).toBe(true);
    expect(grammarPattern.test("/@shikijs/langs/dist/glsl.mjs")).toBe(true);
    expect(grammarPattern.test("/@shikijs/langs/dist/cpp.mjs")).toBe(false);
    expect(grammarPattern.test("/@shikijs/langs/dist/sql.mjs")).toBe(false);

    const reactRuntimePattern =
      typeof codeSplitting === "object" ? codeSplitting.groups?.[1]?.test : undefined;
    expect(reactRuntimePattern).toBeInstanceOf(RegExp);
    if (!(reactRuntimePattern instanceof RegExp)) {
      throw new TypeError("missing React runtime chunk pattern");
    }
    expect(reactRuntimePattern.test("/node_modules/react/index.js")).toBe(true);
    expect(reactRuntimePattern.test("C:\\node_modules\\react-dom\\client.js")).toBe(true);
    expect(reactRuntimePattern.test("/node_modules/scheduler/index.js")).toBe(true);
    expect(reactRuntimePattern.test("/node_modules/react-i18next/index.js")).toBe(false);
  });
});
