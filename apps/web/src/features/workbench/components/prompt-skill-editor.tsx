import type { AgentSkill } from "@codexly/protocol";
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ComponentProps,
} from "react";

import {
  PromptInputTextarea,
  isPromptInputNewlineShortcut,
} from "../../../shared/components/agent/prompt-input.js";
import {
  createPromptSkillContent,
  recognizePromptSkillReferences,
  serializePromptSkillContent,
  type PromptSkillContent,
} from "./prompt-skill-content.js";

export * from "./prompt-skill-content.js";

export type PromptSkillEditorHandle = Readonly<{
  focus: (offset?: number) => void;
  getContent: () => PromptSkillContent;
  replace: (content: PromptSkillContent, cursorOffset?: number) => void;
}>;

type PromptSkillEditorProps = Omit<
  ComponentProps<typeof PromptInputTextarea>,
  "content" | "onChange" | "value"
> &
  Readonly<{
    content: PromptSkillContent;
    onChange: (content: PromptSkillContent, serializedText: string, cursorOffset: number) => void;
    skills: readonly AgentSkill[];
    scope: string;
  }>;

export const PromptSkillEditor = forwardRef<PromptSkillEditorHandle, PromptSkillEditorProps>(
  function PromptSkillEditor(
    { content, onChange, onKeyDown, scope, skills, ...props },
    forwardedRef,
  ) {
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const contentRef = useRef(content);
    const skillsRef = useRef(skills);
    const onChangeRef = useRef(onChange);
    const previousScopeRef = useRef<string | undefined>(undefined);
    skillsRef.current = skills;
    onChangeRef.current = onChange;

    const replace = useCallback((nextContent: PromptSkillContent, cursorOffset?: number) => {
      const input = inputRef.current;
      contentRef.current = nextContent;
      if (input === null) {
        return;
      }
      const value = serializePromptSkillContent(nextContent);
      input.value = value;
      input.dataset["serializedValue"] = value;
      if (cursorOffset !== undefined) {
        input.setSelectionRange(cursorOffset, cursorOffset);
      }
    }, []);

    const readCurrentContent = useCallback((input: HTMLTextAreaElement): PromptSkillContent => {
      if (serializePromptSkillContent(contentRef.current) === input.value) {
        return contentRef.current;
      }
      // 提交与输入事件都从可见文本重建引用，防止尚未同步的编辑发送旧 Skill。
      const nextContent = recognizePromptSkillReferences(
        createPromptSkillContent(input.value),
        skillsRef.current,
      );
      contentRef.current = nextContent;
      input.dataset["serializedValue"] = input.value;
      onChangeRef.current(nextContent, input.value, input.selectionStart);
      return nextContent;
    }, []);

    useImperativeHandle(
      forwardedRef,
      () => ({
        focus(offset) {
          const input = inputRef.current;
          input?.focus();
          if (offset !== undefined) {
            input?.setSelectionRange(offset, offset);
          }
        },
        getContent() {
          const input = inputRef.current;
          return input === null ? contentRef.current : readCurrentContent(input);
        },
        replace,
      }),
      [readCurrentContent, replace],
    );

    useLayoutEffect(() => {
      if (previousScopeRef.current !== scope) {
        previousScopeRef.current = scope;
        replace(content);
      }
    }, [content, replace, scope]);

    useLayoutEffect(() => {
      const input = inputRef.current;
      if (input === null || skills.length === 0) {
        return;
      }
      const recognized = recognizePromptSkillReferences(
        createPromptSkillContent(input.value),
        skills,
      );
      contentRef.current = recognized;
      onChangeRef.current(recognized, input.value, input.selectionStart);
    }, [skills]);

    const emitChange = (input: HTMLTextAreaElement) => {
      readCurrentContent(input);
    };

    return (
      <PromptInputTextarea
        {...props}
        data-prompt-skill-editor=""
        data-serialized-value={serializePromptSkillContent(content)}
        defaultValue={serializePromptSkillContent(content)}
        onChange={(event) => {
          emitChange(event.currentTarget);
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented || !isPromptInputNewlineShortcut(event)) {
            return;
          }
          event.preventDefault();
          const input = event.currentTarget;
          const cursor = input.selectionStart + 1;
          input.setRangeText("\n", input.selectionStart, input.selectionEnd, "end");
          input.setSelectionRange(cursor, cursor);
          emitChange(input);
        }}
        ref={inputRef}
      />
    );
  },
);
