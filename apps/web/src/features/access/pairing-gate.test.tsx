import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { changeAppLanguage } from "../../i18n/i18n.js";
import { PairingGate } from "./pairing-gate.js";

describe("PairingGate", () => {
  beforeEach(() => changeAppLanguage("zh-CN"));

  it("renders an accessible pairing form without inline action errors", () => {
    const markup = renderToStaticMarkup(
      <PairingGate
        error={null}
        loading={false}
        onPair={vi.fn()}
        onRetry={vi.fn()}
        pairing={false}
      />,
    );

    expect(markup).toContain('src="/brand/codexly-logo.svg"');
    expect(markup).toContain('alt="Codexly"');
    expect(markup).not.toContain("access-gate-mark");
    expect(markup).toContain('autoComplete="current-password"');
    expect(markup).toContain('aria-label="访问密码"');
    expect(markup).toContain('data-variant="embedded"');
    expect(markup).not.toContain("无法完成配对，请检查访问密码后重试");
    expect(markup).not.toContain("PAIRING_FAILED");
  });
});
