import {
  CodeBlock as SharedCodeBlock,
  CodeBlockContent as SharedCodeBlockContent,
  CodeBlockCopyButton as SharedCodeBlockCopyButton,
  type CodeBlockProps as SharedCodeBlockProps,
  type CodeBlockContentProps as SharedCodeBlockContentProps,
  type CodeBlockCopyButtonProps as SharedCodeBlockCopyButtonProps,
} from "@codexly/ui/agent/code-block";

import { useTranslation } from "../../../i18n/i18n.js";

export {
  CodeBlockActions,
  CodeBlockFilename,
  CodeBlockHeader,
  CodeBlockTitle,
  type CodeBlockLanguage,
  type CodeBlockActionsProps,
  type CodeBlockFilenameProps,
  type CodeBlockHeaderProps,
  type CodeBlockTitleProps,
} from "@codexly/ui/agent/code-block";

export type CodeBlockProps = Omit<SharedCodeBlockProps, "legacyTheme">;
export type CodeBlockContentProps = Omit<SharedCodeBlockContentProps, "legacyTheme">;
export type CodeBlockCopyButtonProps = Omit<SharedCodeBlockCopyButtonProps, "labels">;

export function CodeBlock(props: CodeBlockProps) {
  return <SharedCodeBlock {...props} />;
}

export function CodeBlockContent(props: CodeBlockContentProps) {
  return <SharedCodeBlockContent {...props} />;
}

export function CodeBlockCopyButton(props: CodeBlockCopyButtonProps) {
  const { t } = useTranslation("conversation");
  return (
    <SharedCodeBlockCopyButton
      {...props}
      labels={{ copy: t("agentComponents.copyCode"), copied: t("agentComponents.copiedCode") }}
    />
  );
}
