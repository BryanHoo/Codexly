import { describe, expect, it, vi } from "vitest";

import { createAsyncActionLock } from "../../../shared/utils/async-action-lock.js";
import { createProjectDraftStore } from "../project-draft-store.js";
import { createProjectDraftComposerActions } from "./project-draft-composer-actions.js";

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

function createActions(
  submitPrompt = vi.fn(async () => true),
  attachments: Parameters<typeof createProjectDraftComposerActions>[0]["attachments"] = [],
  uploadAttachment = vi.fn(),
) {
  const store = createProjectDraftStore(createMemoryStorage(), {
    createId: () => "draft-a",
    now: () => 1_000,
  });
  store.create("project-a", {
    attachments: [],
    content: [{ text: "已保存内容", type: "text" }],
  });
  store.updateWorking("project-a", "draft-a", {
    attachments: [],
    content: [{ text: "待保存内容", type: "text" }],
  });
  const onEditingComplete = vi.fn();
  const onPromptChange = vi.fn();
  const actions = createProjectDraftComposerActions({
    actionLock: createAsyncActionLock(),
    attachmentUploadPromises: { current: new Map() },
    attachments,
    clearComposerInput: vi.fn(),
    client: { uploadAttachment },
    editingDraftId: "draft-a",
    fallbackErrors: {
      attachmentUpload: "附件上传失败",
      saveDraft: "草稿保存失败",
    },
    hasComposerInput: true,
    isCurrentScope: () => true,
    isSubmitting: false,
    onAttachmentsChange: vi.fn(),
    onEditingComplete,
    onPromptChange,
    projectDraftStore: store,
    projectId: "project-a",
    promptContent: [{ text: "待保存内容", type: "text" }],
    routeScope: "project-a:task-a",
    setIsSubmitting: vi.fn(),
    setMutationError: vi.fn(),
    skillEditorRef: { current: null },
    submitPrompt,
    uploadAttempts: { current: new Map() },
    uploadedAttachments: { current: new Map() },
  });
  return { actions, onEditingComplete, onPromptChange, store, submitPrompt };
}

describe("project draft composer actions", () => {
  it("updates the saved version only through the explicit save action", async () => {
    const { actions, onEditingComplete, store } = createActions();

    expect(store.read("project-a", "draft-a")?.draft.content).toEqual([
      { text: "已保存内容", type: "text" },
    ]);

    await actions.save();

    expect(store.read("project-a", "draft-a")?.draft.content).toEqual([
      { text: "待保存内容", type: "text" },
    ]);
    expect(store.readWorking("project-a", "draft-a")).toBeUndefined();
    expect(onEditingComplete).toHaveBeenCalledOnce();
  });

  it("removes a restored draft only after a successful submission", async () => {
    const failed = createActions(vi.fn(async () => false));
    await failed.actions.submit({ files: [], text: "发送" });
    expect(failed.store.read("project-a", "draft-a")).toBeDefined();

    const succeeded = createActions();
    await succeeded.actions.submit({ files: [], text: "发送" });
    expect(succeeded.store.read("project-a", "draft-a")).toBeUndefined();
    expect(succeeded.onEditingComplete).toHaveBeenCalledOnce();
  });

  it("exits draft editing and discards the working copy when the composer is cleared", () => {
    const { actions, onEditingComplete, onPromptChange, store } = createActions();

    actions.changePrompt([], "", 0);

    expect(onPromptChange).toHaveBeenCalledWith([], "", 0);
    expect(store.readWorking("project-a", "draft-a")).toBeUndefined();
    expect(store.read("project-a", "draft-a")?.draft.content).toEqual([
      { text: "已保存内容", type: "text" },
    ]);
    expect(onEditingComplete).toHaveBeenCalledOnce();
  });

  it("reuses an in-flight browser attachment upload when save follows selection", async () => {
    const attachment = {
      file: new File(["draft"], "draft.txt", { type: "text/plain" }),
      id: "browser-a",
      kind: "file" as const,
      mediaType: "text/plain",
      name: "draft.txt",
      previewUrl: "blob:draft-a",
      size: 5,
      source: "browser" as const,
    };
    let resolveUpload: ((value: { attachment: never }) => void) | undefined;
    const uploadAttachment = vi.fn(
      () =>
        new Promise<{ attachment: never }>((resolve) => {
          resolveUpload = resolve;
        }),
    );
    const { actions } = createActions(vi.fn(async () => true), [attachment], uploadAttachment);

    actions.changeAttachments([attachment]);
    const savePromise = actions.save();
    await vi.waitFor(() => expect(uploadAttachment).toHaveBeenCalledOnce());
    resolveUpload?.({
      attachment: {
        id: "host-a",
        kind: "file",
        mediaType: "text/plain",
        name: "draft.txt",
        size: 5,
      } as never,
    });
    await savePromise;

    expect(uploadAttachment).toHaveBeenCalledOnce();
  });
});
