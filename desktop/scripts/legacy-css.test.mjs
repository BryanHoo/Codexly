import assert from "node:assert/strict";
import test from "node:test";
import postcss from "postcss";
import { legacyCssPlugins } from "./legacy-css.mjs";

void test("Legacy CSS should lower theme colors and nesting without freezing theme changes", async () => {
  const { css } = await postcss(legacyCssPlugins()).process(`
    :root { color-scheme: light dark; --ink: light-dark(#111, #fff); }
    [data-theme=dark] { color-scheme: dark; }
    .panel { color: var(--ink); & .child { color: red; } }
  `, { from: undefined });
  assert.doesNotMatch(css, /light-dark\(/);
  assert.match(css, /--csstools-color-scheme--light/);
  assert.match(css, /\.panel .child/);
});

void test("Legacy CSS should retain readable surfaces when dynamic color mixing is unavailable", async () => {
  const { css } = await postcss(legacyCssPlugins()).process(`
    .panel { --ui-color-raised: color-mix(in oklab, var(--ui-color-wallpaper-overlay) 68%, transparent);
      background: color-mix(in srgb, var(--ui-color-text) 2%, var(--ui-color-content)); }
  `, { from: undefined });
  assert.doesNotMatch(css, /color-mix\(/);
  assert.match(css, /--ui-color-raised: var\(--ui-color-wallpaper-overlay\)/);
  assert.match(css, /background: var\(--ui-color-content\)/);
});
