import type { AgentSkill } from "@/protocol/index.js";
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ComponentProps,
} from "react";

import { PromptInputTextarea } from "../../../shared/components/agent/prompt-input.js";
import {
  parsePromptReferenceText,
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
  "children" | "content" | "defaultValue" | "onChange" | "value"
> & Readonly<{
  content: PromptSkillContent;
  onChange: (content: PromptSkillContent, serializedText: string, cursorOffset: number) => void;
  skills: readonly AgentSkill[];
  scope: string;
}>;

export const PromptSkillEditor = forwardRef<PromptSkillEditorHandle, PromptSkillEditorProps>(
  function PromptSkillEditor({ content, onChange, skills, scope, ...props }, forwardedRef) {
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const contentRef = useRef(content);
    const skillsRef = useRef(skills);
    const previousScopeRef = useRef<string | undefined>(undefined);
    skillsRef.current = skills;

    const resize = (input: HTMLTextAreaElement) => {
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
    };
    const getContent = () => {
      const input = inputRef.current;
      return input === null
        ? contentRef.current
        : parsePromptReferenceText(input.value, contentRef.current, skillsRef.current);
    };
    const replace = useCallback((nextContent: PromptSkillContent, cursorOffset?: number) => {
      contentRef.current = nextContent;
      const input = inputRef.current;
      if (input === null) return;
      input.value = serializePromptSkillContent(nextContent);
      resize(input);
      if (cursorOffset !== undefined) input.setSelectionRange(cursorOffset, cursorOffset);
    }, []);

    useImperativeHandle(forwardedRef, () => ({
      focus(offset) {
        const input = inputRef.current;
        input?.focus();
        if (offset !== undefined) input?.setSelectionRange(offset, offset);
      },
      getContent,
      replace,
    }));

    useLayoutEffect(() => {
      if (previousScopeRef.current === scope) return;
      previousScopeRef.current = scope;
      replace(content);
    }, [content, replace, scope]);

    return (
      <PromptInputTextarea
        {...props}
        data-prompt-skill-editor=""
        defaultValue={serializePromptSkillContent(content)}
        onChange={(event) => {
          const input = event.currentTarget;
          const nextContent = parsePromptReferenceText(input.value, contentRef.current, skillsRef.current);
          contentRef.current = nextContent;
          resize(input);
          onChange(nextContent, input.value, input.selectionStart);
        }}
        ref={inputRef}
      />
    );
  },
);
