import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const APP_ICON_SOURCE = new URL("../src-tauri/icons/macos-app-icon.svg", import.meta.url);

void test("macOS app icon should preserve the optical safe margin", async () => {
  const source = await readFile(APP_ICON_SOURCE, "utf8");

  assert.match(source, /viewBox="0 0 512 512"/);
  assert.match(source, /transform="translate\(50 50\) scale\(6\.4375\)"/);
});
