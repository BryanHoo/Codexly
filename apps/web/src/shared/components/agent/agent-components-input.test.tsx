import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from "./attachments.js";
import {
  Confirmation,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRequest,
  ConfirmationTitle,
} from "./confirmation.js";
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputBody,
  PromptInputCommand,
  PromptInputCommandEmpty,
  PromptInputCommandGroup,
  PromptInputCommandItem,
  PromptInputCommandList,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  createPastedTextFile,
  isPromptInputNewlineShortcut,
} from "./prompt-input.js";
import "./agent-components.test-support.js";

describe("agent input components", () => {
  it("renders an accessible prompt input composition", () => {
    const markup = renderToStaticMarkup(
      <PromptInput
        disabled
        fileAccept=".pdf,.docx,.xlsx,.txt,.md"
        imageAccept=".png,.jpg,.jpeg,.webp,.gif"
        multiple
      >
        <PromptInputBody>
          <PromptInputTextarea aria-label="任务输入" disabled />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>
            <PromptInputActionAddAttachments onSelectKind={vi.fn()} />
          </PromptInputTools>
          <PromptInputSubmit aria-label="提交" disabled status="idle" />
        </PromptInputFooter>
      </PromptInput>,
    );

    expect(markup).toContain('aria-label="任务输入"');
    expect(markup).toContain('aria-label="提交"');
    expect(markup).toContain("disabled");
    expect(markup).toContain("shadow-floating");
    expect(markup).not.toContain('type="file"');
    expect(markup).toContain('aria-label="添加图片或文件"');
    expect(markup).toContain("添加图片");
    expect(markup).toContain("添加文件");
    expect(markup).not.toContain("aria-disabled");
    expect(markup).toContain('data-prompt-input=""');
  });

  it("识别多平台输入框换行快捷键", () => {
    expect(
      isPromptInputNewlineShortcut({
        ctrlKey: false,
        key: "Enter",
        metaKey: false,
        shiftKey: true,
      }),
    ).toBe(true);
    expect(
      isPromptInputNewlineShortcut({
        ctrlKey: false,
        key: "Enter",
        metaKey: true,
        shiftKey: false,
      }),
    ).toBe(true);
    expect(
      isPromptInputNewlineShortcut({
        ctrlKey: true,
        key: "Enter",
        metaKey: false,
        shiftKey: false,
      }),
    ).toBe(true);
    expect(
      isPromptInputNewlineShortcut({
        ctrlKey: false,
        key: "Enter",
        metaKey: false,
        shiftKey: false,
      }),
    ).toBe(false);
    expect(
      isPromptInputNewlineShortcut({ ctrlKey: true, key: "a", metaKey: false, shiftKey: false }),
    ).toBe(false);
  });

  it("creates a text file only when pasted text exceeds the configured threshold", () => {
    expect(createPastedTextFile("x".repeat(1_000), 1_000, "Pasted text.txt")).toBeUndefined();

    const attachment = createPastedTextFile("你".repeat(1_001), 1_000, "Pasted text.txt");

    expect(attachment).toMatchObject({
      name: "Pasted text.txt",
      size: 3_003,
      type: "text/plain",
    });
  });

  it("renders attachment previews and removal controls", () => {
    const markup = renderToStaticMarkup(
      <Attachments>
        <Attachment
          data={{
            id: "attachment-1",
            kind: "image",
            mediaType: "image/png",
            name: "screen.png",
            previewUrl: "data:image/png;base64,aW1hZ2U=",
            size: 5,
          }}
        >
          <AttachmentPreview />
          <AttachmentInfo />
          <AttachmentRemove aria-label="移除 screen.png" />
        </Attachment>
      </Attachments>,
    );

    expect(markup).toContain("screen.png");
    expect(markup).toContain('src="data:image/png;base64,aW1hZ2U="');
    expect(markup).toContain('width="28"');
    expect(markup).toContain('height="28"');
    expect(markup).toContain('aria-label="移除 screen.png"');
  });

  it("renders pasted text attachments as files", () => {
    const markup = renderToStaticMarkup(
      <Attachments>
        <Attachment
          data={{
            id: "attachment-text",
            kind: "text",
            mediaType: "text/plain",
            name: "Pasted text.txt",
            previewUrl: "blob:text",
            size: 1_001,
          }}
        >
          <AttachmentPreview />
          <AttachmentInfo />
        </Attachment>
      </Attachments>,
    );

    expect(markup).toContain('data-attachment-preview="file"');
    expect(markup).toContain("Pasted text.txt");
    expect(markup).not.toContain("<img");
  });

  it("renders an accessible prompt command composition", () => {
    const markup = renderToStaticMarkup(
      <PromptInputCommand aria-label="输入命令">
        <PromptInputCommandList>
          <PromptInputCommandGroup label="命令">
            <PromptInputCommandItem active selected>
              选择项目
            </PromptInputCommandItem>
          </PromptInputCommandGroup>
          <PromptInputCommandEmpty hidden>没有匹配的命令</PromptInputCommandEmpty>
        </PromptInputCommandList>
      </PromptInputCommand>,
    );

    expect(markup).toContain('role="listbox"');
    expect(markup).toContain('aria-label="输入命令"');
    expect(markup).toContain('role="option"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain("选择项目");
    expect(markup).toContain('data-prompt-input-command=""');
    expect(markup).toContain("h-auto min-h-8");
  });

  it("renders an accessible confirmation composition", () => {
    const markup = renderToStaticMarkup(
      <Confirmation approval={{ id: "request-1" }} state="approval-requested">
        <ConfirmationTitle>命令审批</ConfirmationTitle>
        <ConfirmationRequest>pnpm check</ConfirmationRequest>
        <ConfirmationActions>
          <ConfirmationAction>拒绝</ConfirmationAction>
          <ConfirmationAction>允许</ConfirmationAction>
        </ConfirmationActions>
      </Confirmation>,
    );

    expect(markup).toContain('aria-label="命令审批请求"');
    expect(markup).toContain('data-state="approval-requested"');
    expect(markup).toContain("pnpm check");
    expect(markup).toContain("拒绝");
    expect(markup).toContain("允许");
  });
});
