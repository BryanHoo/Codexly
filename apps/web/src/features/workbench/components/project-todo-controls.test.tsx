import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { I18nextProvider, i18n } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import type { ProjectTodoRecord } from "../project-todo-store.js";
import { ComposerTodoSaveButton, ProjectTodoList } from "./project-todo-controls.js";

const todos: readonly ProjectTodoRecord[] = [
  {
    createdAt: 1_000,
    draft: { attachments: [], content: [{ text: "修复登录状态恢复", type: "text" }] },
    id: "todo-a",
    updatedAt: 2_000,
    workingDraft: { attachments: [], content: [{ text: "尚未保存的修改", type: "text" }] },
  },
];

describe("project todo controls", () => {
  it("renders a compact accessible todo entry point", async () => {
    await i18n.changeLanguage("zh-CN");
    const markup = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <TooltipProvider>
          <ProjectTodoList
            composerHasInput={false}
            onDelete={vi.fn()}
            onRestore={vi.fn()}
            projectName="Codexly"
            todos={todos}
          />
        </TooltipProvider>
      </I18nextProvider>,
    );

    expect(markup).toContain('aria-label="待办 1"');
    expect(markup).toContain("待办 1");
  });

  it("exposes explicit create and update actions", async () => {
    await i18n.changeLanguage("zh-CN");
    const markup = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <TooltipProvider>
          <ComposerTodoSaveButton disabled={false} editing={false} onSave={vi.fn()} />
          <ComposerTodoSaveButton disabled={false} editing onSave={vi.fn()} />
        </TooltipProvider>
      </I18nextProvider>,
    );

    expect(markup).toContain('aria-label="保存为待办"');
    expect(markup).toContain('aria-label="保存待办修改"');
  });
});
