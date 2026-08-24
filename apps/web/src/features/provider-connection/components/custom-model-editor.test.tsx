import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { changeAppLanguage } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { CustomModelEditor } from "./custom-model-editor.js";

describe("CustomModelEditor", () => {
  beforeEach(async () => {
    await changeAppLanguage("zh-CN");
  });

  it("renders structured model rows with accessible actions", () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <CustomModelEditor
          disabled={false}
          models={[{ id: "custom-id", key: "model-1", name: "自定义模型" }]}
          onAdd={vi.fn()}
          onChange={vi.fn()}
          onRemove={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(markup).toContain("模型 ID");
    expect(markup).toContain("模型名称");
    expect(markup).toContain('value="custom-id"');
    expect(markup).toContain('value="自定义模型"');
    expect(markup).toContain('aria-label="删除模型"');
    expect(markup).toContain("添加模型");
    expect(markup).not.toContain("textarea");
  });
});
