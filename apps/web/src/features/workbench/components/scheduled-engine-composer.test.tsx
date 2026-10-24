import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WorkbenchComposer, type WorkbenchComposerProps } from "./workbench-composer.js";
import { SelectedEnginesContext } from "@codexly/ui/core/engine-selection";

const { useEngineComposerState, captured } = vi.hoisted(() => ({
  useEngineComposerState: vi.fn(() => ({
    engine: "claude",
    pending: false,
    codexConfigured: true,
    claudeConfigured: true,
    locked: false,
    submitting: false,
    select: vi.fn(),
    setSubmitting: vi.fn(),
  })),
  captured: vi.fn(),
}));
vi.mock("@codexly/ui/core/engine-composer-state", () => ({ useEngineComposerState }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { state: "connected" } }),
  useQueryClient: () => ({
    getQueryData: vi.fn(),
    fetchQuery: vi.fn(),
    invalidateQueries: vi.fn(),
  }),
  queryOptions: (value: unknown) => value,
}));
vi.mock("../../../i18n/i18n.js", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./workbench-composer-base.js", () => ({
  WorkbenchComposerBase: (props: { engineControls: React.ReactNode }) => {
    captured(props);
    return props.engineControls;
  },
}));

describe("scheduled engine composer", () => {
  it.each(["codex", "claude"] as const)("仅启用 %s 时不挂载引擎选择器", (engine) => {
    const markup = renderToStaticMarkup(
      <SelectedEnginesContext value={[engine]}>
        <WorkbenchComposer
          {...({
            projectId: "project",
            client: {},
            models: [],
            settings: {},
          } as unknown as WorkbenchComposerProps)}
        />
      </SelectedEnginesContext>,
    );
    // 即便还留有另一引擎的已连接缓存，单引擎上下文也必须直接跳过选择器。
    expect(markup).toBe("");
  });

  it("allows engine selection during capture and restores the saved engine in its own scope", () => {
    const markup = renderToStaticMarkup(
      <WorkbenchComposer
        {...({
          projectId: "project",
          composerDraftId: "scheduled:one",
          initialEngine: "claude",
          client: {},
          onCaptureSubmission: vi.fn(),
          models: [],
          settings: {
            model: "sonnet",
            reasoningEffort: "",
            engineOptions: { engine: "claude", permissionMode: "plan" },
          },
        } as unknown as WorkbenchComposerProps)}
      />,
    );
    expect(markup).toContain("Claude");
    expect(markup).not.toContain("Claude Agent");
    expect(markup).not.toContain('disabled=""');
    expect(useEngineComposerState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scope: JSON.stringify(["project", "scheduled:one"]),
        initialEngine: "claude",
      }),
    );
    expect(captured).toHaveBeenLastCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          model: "sonnet",
          engineOptions: { engine: "claude", permissionMode: "plan" },
        }) as unknown,
      }),
    );
  });
});

// 两端必须尊重同一跟进偏好，不能按引擎固定成排队或引导。
it.each(["queue", "steer"] as const)(
  "preserves Claude follow-up preference: %s",
  (followUpBehavior) => {
    renderToStaticMarkup(
      createElement(WorkbenchComposer, {
        projectId: "project",
        client: {},
        models: [],
        followUpBehavior,
        settings: {
          model: "default",
          reasoningEffort: "",
          engineOptions: { engine: "claude", permissionMode: "default" },
        },
      } as unknown as WorkbenchComposerProps),
    );
    expect(captured).toHaveBeenLastCalledWith(expect.objectContaining({ followUpBehavior }));
  },
);
