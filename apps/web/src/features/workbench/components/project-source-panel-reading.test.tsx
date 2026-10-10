import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type * as ReactQuery from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CodexlyWorkbenchClient } from "../../projects/project-queries.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { ProjectSourcePanel } from "./project-source-panel.js";

const state = vi.hoisted(() => ({
  preview: false,
  paging: false,
  editorEnabled: false,
  editor: {
    ready: false,
    loading: true,
    fallback: false,
    path: undefined as string | undefined,
    element: null,
    getContent: vi.fn(() => "# 共享会话正文\n"),
    hasUnsavedChanges: () => false,
    flush: () => Promise.resolve(true),
    runAfterSave: (action: () => void) => {
      action();
    },
  },
}));

vi.mock("@codexly/ui/core/inline-text-file", () => ({
  useInlineTextFile: (options: { enabled: boolean }) => {
    state.editorEnabled = options.enabled;
    return state.editor;
  },
}));
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactQuery>();
  return {
    ...actual,
    useInfiniteQuery: (...args: Parameters<typeof actual.useInfiniteQuery>) => {
      state.paging = args[0].enabled === true;
      return actual.useInfiniteQuery(...args);
    },
  };
});
vi.mock("../markdown-preview-preference.js", () => ({
  getMarkdownPreviewPreferenceStorage: () => undefined,
  readMarkdownPreviewPreference: () => state.preview,
  writeMarkdownPreviewPreference: () => undefined,
}));

function render(path = "file.txt", rootPath: string | null = "/workspace") {
  const queryClient = new QueryClient();
  // 保留此前只读预览缓存，验证编辑器等待期间也不会展示或处理旧分页正文。
  queryClient.setQueryData(["projects", "project", rootPath ?? null, "source-file", path], {
    pages: [{ content: "旧分页正文", path, nextCursor: null }],
    pageParams: [undefined],
  });
  const markup = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ProjectSourcePanel
          client={{} as CodexlyWorkbenchClient}
          previewKind="source"
          projectId="project"
          reference={{ path, lineNumber: null }}
          {...(rootPath === null ? {} : { rootPath })}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  queryClient.clear();
  return markup;
}

beforeEach(() => {
  state.preview = false;
  Object.assign(state.editor, { ready: false, loading: true, fallback: false, path: undefined });
  state.editor.getContent.mockClear();
});

describe("project source read ownership", () => {
  it("waits for the editor without requesting or rendering cached preview pages", () => {
    const markup = render();
    expect(state.editorEnabled).toBe(true);
    expect(state.paging).toBe(false);
    expect(markup).toContain('role="status"');
    expect(markup).not.toContain("旧分页正文");
    expect(markup).not.toContain("data-language=");
  });

  it("uses the editor session without serializing a second copy for raw source", () => {
    Object.assign(state.editor, { ready: true, loading: false });
    render();
    expect(state.paging).toBe(false);
    expect(state.editor.getContent).not.toHaveBeenCalled();
  });

  it("renders Markdown from the same active session even with a cached preview page", () => {
    state.preview = true;
    Object.assign(state.editor, { ready: true, loading: false });
    const markup = render("file.md");
    expect(state.editorEnabled).toBe(true);
    expect(state.paging).toBe(false);
    expect(state.editor.getContent).toHaveBeenCalledOnce();
    expect(markup).not.toContain("旧分页正文");
    expect(markup).toContain("共享会话正文");
  });

  it("enables pagination only after the editor reports a fallback", () => {
    Object.assign(state.editor, { loading: false, fallback: true });
    const markup = render();
    expect(state.paging).toBe(true);
    expect(markup).toContain("旧分页正文");
    expect(markup).toContain("data-language=");
  });

  it("keeps external references without a project root on the preview path", () => {
    Object.assign(state.editor, { loading: false });
    render("external.txt", null);
    expect(state.editorEnabled).toBe(false);
    expect(state.paging).toBe(true);
  });
});
