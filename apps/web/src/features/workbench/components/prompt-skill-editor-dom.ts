import type { AgentSkill, ProjectFileSearchEntry } from "@code-agent/protocol";

import { i18n } from "../../../i18n/i18n.js";
import {
  normalizePromptSkillContent,
  fileReferencePlainText,
  projectFileReferenceKey,
  serializePromptSkillContent,
  skillPlainText,
  type PromptSkillContent,
  type PromptSkillContentPart,
} from "./prompt-skill-content.js";
import { skillTokenClassName } from "./skill-token.js";

const blockElementNames = new Set(["DIV", "P"]);
export const caretAnchorText = "\u200b";

export function createEditorSkillNode(
  skill: AgentSkill,
  iconTemplate: SVGSVGElement | null,
): HTMLElement {
  const token = document.createElement("span");
  token.className = `${skillTokenClassName} relative top-0.5 cursor-pointer select-none hover:bg-control-hover`;
  token.contentEditable = "false";
  token.dataset["promptSkillId"] = skill.id;
  token.dataset["promptSkillName"] = skill.name;
  token.dataset["serializedText"] = skillPlainText(skill);
  token.setAttribute(
    "aria-label",
    i18n.t("skillEditor.tokenLabel", {
      name: skill.displayName,
      ns: "workbench",
      text: skillPlainText(skill),
    }),
  );
  token.setAttribute("role", "button");
  token.tabIndex = -1;
  if (iconTemplate !== null) {
    const icon = iconTemplate.cloneNode(true) as SVGSVGElement;
    icon.classList.remove("hidden");
    token.append(icon);
  }
  const label = document.createElement("span");
  label.className = "truncate";
  label.textContent = skill.displayName;
  token.append(label);
  return token;
}

export function createEditorFileNode(
  file: ProjectFileSearchEntry,
  iconTemplate: SVGSVGElement | null,
): HTMLElement {
  const token = document.createElement("span");
  token.className = `${skillTokenClassName} relative top-0.5 cursor-pointer select-none hover:bg-control-hover`;
  token.contentEditable = "false";
  token.dataset["promptFilePath"] = file.path;
  token.dataset["promptFileRootId"] = file.rootId;
  token.dataset["serializedText"] = fileReferencePlainText(file);
  token.setAttribute("aria-label", fileReferencePlainText(file));
  token.setAttribute("role", "button");
  token.tabIndex = -1;
  if (iconTemplate !== null) {
    const icon = iconTemplate.cloneNode(true) as SVGSVGElement;
    icon.classList.remove("hidden");
    token.append(icon);
  }
  const label = document.createElement("span");
  label.className = "truncate";
  label.textContent = file.name;
  token.append(label);
  return token;
}

export function createCaretAnchorNode(): HTMLSpanElement {
  const caretAnchor = document.createElement("span");
  caretAnchor.dataset["promptCaretAnchor"] = "";
  caretAnchor.textContent = caretAnchorText;
  return caretAnchor;
}

export function renderEditorContent(
  root: HTMLDivElement,
  content: PromptSkillContent,
  skillIconTemplate: SVGSVGElement | null,
  fileIconTemplate: SVGSVGElement | null,
): void {
  const nodes: Node[] = [];
  for (const part of content) {
    if (part.type === "text") {
      nodes.push(document.createTextNode(part.text));
    } else if (part.type === "skill") {
      nodes.push(createEditorSkillNode(part.skill, skillIconTemplate), createCaretAnchorNode());
    } else {
      nodes.push(createEditorFileNode(part.file, fileIconTemplate), createCaretAnchorNode());
    }
  }
  root.replaceChildren(...nodes);
  root.dataset["empty"] = String(content.length === 0);
  root.dataset["serializedValue"] = serializePromptSkillContent(content);
}

export function readEditorContent(
  root: HTMLDivElement,
  skillsById: ReadonlyMap<string, AgentSkill>,
  filesByIdentity: ReadonlyMap<string, ProjectFileSearchEntry>,
): PromptSkillContent {
  const parts: PromptSkillContentPart[] = [];
  const appendText = (text: string) => {
    if (text !== "") {
      parts.push({ text, type: "text" });
    }
  };
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      appendText(node.textContent ?? "");
      return;
    }
    if (!(node instanceof HTMLElement)) {
      return;
    }
    const skillId = node.dataset["promptSkillId"];
    if (skillId !== undefined) {
      const skill = skillsById.get(skillId);
      if (skill !== undefined) {
        parts.push({ skill, type: "skill" });
      }
      return;
    }
    const filePath = node.dataset["promptFilePath"];
    const fileRootId = node.dataset["promptFileRootId"];
    if (filePath !== undefined && fileRootId !== undefined) {
      const file = filesByIdentity.get(
        projectFileReferenceKey({ path: filePath, rootId: fileRootId }),
      );
      if (file !== undefined) {
        parts.push({ file, type: "file" });
      }
      return;
    }
    if (node.dataset["promptCaretAnchor"] !== undefined) {
      const text = node.textContent;
      appendText(text.startsWith(caretAnchorText) ? text.slice(caretAnchorText.length) : text);
      return;
    }
    if (node.tagName === "BR") {
      appendText("\n");
      return;
    }
    const startsBlock = blockElementNames.has(node.tagName) && parts.length > 0;
    if (startsBlock) {
      appendText("\n");
    }
    node.childNodes.forEach(visit);
  };
  root.childNodes.forEach(visit);
  return normalizePromptSkillContent(parts);
}

export function serializedNodeLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent?.length ?? 0;
  }
  if (!(node instanceof HTMLElement)) {
    return 0;
  }
  const serializedText = node.dataset["serializedText"];
  if (serializedText !== undefined) {
    return serializedText.length;
  }
  if (node.dataset["promptCaretAnchor"] !== undefined) {
    const text = node.textContent;
    return text.startsWith(caretAnchorText) ? text.length - caretAnchorText.length : text.length;
  }
  if (node.tagName === "BR") {
    return 1;
  }
  return [...node.childNodes].reduce((total, child) => total + serializedNodeLength(child), 0);
}

export function serializedPointOffset(
  root: HTMLDivElement,
  target: Node | null,
  targetOffset: number,
): number | undefined {
  if (target === null || !root.contains(target)) {
    return undefined;
  }
  let offset = 0;
  let found = false;
  const visit = (node: Node) => {
    if (found) {
      return;
    }
    if (node === target) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent ?? "";
        const anchorLength =
          node.parentElement?.dataset["promptCaretAnchor"] !== undefined &&
          text.startsWith(caretAnchorText)
            ? caretAnchorText.length
            : 0;
        offset += Math.max(0, Math.min(targetOffset, text.length) - anchorLength);
      } else {
        offset += [...node.childNodes]
          .slice(0, targetOffset)
          .reduce((total, child) => total + serializedNodeLength(child), 0);
      }
      found = true;
      return;
    }
    if (node instanceof Element && node.contains(target)) {
      node.childNodes.forEach(visit);
      return;
    }
    offset += serializedNodeLength(node);
  };
  root.childNodes.forEach(visit);
  return offset;
}

export function selectionOffset(root: HTMLDivElement): number {
  const selection = document.getSelection();
  return (
    serializedPointOffset(root, selection?.anchorNode ?? null, selection?.anchorOffset ?? 0) ??
    root.dataset["serializedValue"]?.length ??
    0
  );
}

export function findDomPoint(
  root: HTMLDivElement,
  requestedOffset: number,
): readonly [Node, number] {
  let remaining = Math.max(0, requestedOffset);
  for (const [index, node] of [...root.childNodes].entries()) {
    const length = serializedNodeLength(node);
    if (remaining === 0) {
      if (node instanceof HTMLElement && node.dataset["promptCaretAnchor"] !== undefined) {
        const anchorText = node.firstChild;
        if (anchorText !== null) {
          // WebKit 需要真实可编辑文本节点，才能把末尾 Token 后的光标绘制在正确位置。
          return [anchorText, caretAnchorText.length];
        }
      }
      return [root, index];
    }
    if (node.nodeType === Node.TEXT_NODE && remaining <= length) {
      return [node, remaining];
    }
    if (remaining < length) {
      return remaining < length / 2 ? [root, index] : [root, index + 1];
    }
    remaining -= length;
  }
  return [root, root.childNodes.length];
}

export function placeCaret(root: HTMLDivElement, offset: number): void {
  const [node, nodeOffset] = findDomPoint(root, offset);
  const range = document.createRange();
  range.setStart(node, nodeOffset);
  range.collapse(true);
  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export function insertPlainTextAtSelection(root: HTMLDivElement, text: string): void {
  root.focus();
  // 通过浏览器编辑命令插入纯文本，使粘贴操作进入 contentEditable 的原生撤销栈。
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- 标准 Selection API 无法生成原生撤销记录。
  document.execCommand("insertText", false, text);
}

export function insertLineBreakAtSelection(root: HTMLDivElement): void {
  const selection = document.getSelection();
  const range = selection?.rangeCount === 0 ? undefined : selection?.getRangeAt(0);
  const lineBreak = document.createElement("br");
  const caretAnchor = document.createElement("span");
  const anchorText = document.createTextNode(caretAnchorText);
  caretAnchor.dataset["promptCaretAnchor"] = "";
  caretAnchor.append(anchorText);
  if (range === undefined || !root.contains(range.commonAncestorContainer)) {
    root.append(lineBreak, caretAnchor);
    const fallbackRange = document.createRange();
    fallbackRange.setStart(anchorText, caretAnchorText.length);
    fallbackRange.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(fallbackRange);
    return;
  }
  // 零宽锚点让各浏览器都能把后续文字插入 BR 之后，并且不会进入序列化内容。
  range.deleteContents();
  range.insertNode(lineBreak);
  lineBreak.after(caretAnchor);
  range.setStart(anchorText, caretAnchorText.length);
  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);
}
