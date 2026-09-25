import type { AgentSkill, ProjectFileSearchEntry } from "@/protocol/index.js";

import type { PromptSlashCommand } from "./prompt-command.js";

export type PromptSkillContentPart =
  | Readonly<{ file: ProjectFileSearchEntry; type: "file" }>
  | Readonly<{ skill: AgentSkill; type: "skill" }>
  | Readonly<{ text: string; type: "text" }>;

export type PromptSkillContent = readonly PromptSkillContentPart[];

export type PromptSkillSubmission = Readonly<{
  skills: readonly AgentSkill[];
  text: string;
}>;

export function createPromptSkillContent(text = ""): PromptSkillContent {
  return text === "" ? [] : [{ text, type: "text" }];
}

export function createPromptSkillContentFromSubmission(
  text: string,
  skills: readonly AgentSkill[],
): PromptSkillContent {
  const parsed = parsePromptReferenceText(text, [], skills);
  const presentSkillIds = new Set(
    parsed.flatMap((part) => (part.type === "skill" ? [part.skill.id] : [])),
  );
  return normalizePromptSkillContent([
    ...skills.filter((skill) => !presentSkillIds.has(skill.id)).flatMap((skill) => [
      { skill, type: "skill" as const },
      { text: " ", type: "text" as const },
    ]),
    ...parsed,
  ]);
}

export function normalizePromptSkillContent(
  parts: readonly PromptSkillContentPart[],
): PromptSkillContent {
  const normalized: PromptSkillContentPart[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      if (part.text === "") {
        continue;
      }
      const previous = normalized.at(-1);
      if (previous?.type === "text") {
        normalized[normalized.length - 1] = {
          text: previous.text + part.text,
          type: "text",
        };
      } else {
        normalized.push(part);
      }
      continue;
    }
    normalized.push(part);
  }
  return normalized;
}

export function skillPlainText(skill: Pick<AgentSkill, "name">): string {
  return `$${skill.name}`;
}

export function projectFileReferenceKey(
  file: Pick<ProjectFileSearchEntry, "path" | "rootId">,
): string {
  return `${file.rootId}\u0000${file.path}`;
}

export function fileReferencePlainText(
  file: Pick<ProjectFileSearchEntry, "path" | "rootPath">,
): string {
  const usesWindowsSeparator = file.rootPath.includes("\\") && !file.rootPath.includes("/");
  const separator = usesWindowsSeparator ? "\\" : "/";
  const rootPath = file.rootPath.replace(/[\\/]+$/u, "");
  const relativePath = usesWindowsSeparator
    ? file.path.replace(/\//gu, "\\").replace(/^\\+/u, "")
    : file.path.replace(/\\/gu, "/").replace(/^\/+/u, "");
  return `@${rootPath}${separator}${relativePath}`;
}

export function partLength(part: PromptSkillContentPart): number {
  return part.type === "text"
    ? part.text.length
    : part.type === "skill"
      ? skillPlainText(part.skill).length
      : fileReferencePlainText(part.file).length;
}

export function splitPromptSkillContent(
  content: PromptSkillContent,
  offset: number,
): readonly [PromptSkillContent, PromptSkillContent] {
  const before: PromptSkillContentPart[] = [];
  const after: PromptSkillContentPart[] = [];
  let position = 0;
  for (const part of content) {
    const length = partLength(part);
    const end = position + length;
    if (offset <= position) {
      after.push(part);
    } else if (offset >= end) {
      before.push(part);
    } else if (part.type === "text") {
      const localOffset = offset - position;
      before.push({ text: part.text.slice(0, localOffset), type: "text" });
      after.push({ text: part.text.slice(localOffset), type: "text" });
    } else {
      // Skill Token 不可编辑，选区落入其纯文本范围时按最接近的边界处理。
      (offset - position < length / 2 ? after : before).push(part);
    }
    position = end;
  }
  return [normalizePromptSkillContent(before), normalizePromptSkillContent(after)];
}

export function isPromptTextRange(
  content: PromptSkillContent,
  range: Readonly<{ end: number; start: number }>,
): boolean {
  let position = 0;
  for (const part of content) {
    const end = position + partLength(part);
    if (range.start >= position && range.end <= end) {
      return part.type === "text";
    }
    position = end;
  }
  return false;
}

export function insertPromptSkill(
  content: PromptSkillContent,
  slashCommand: Pick<PromptSlashCommand, "end" | "start">,
  skill: AgentSkill,
): PromptSkillContent {
  const [before] = splitPromptSkillContent(content, slashCommand.start);
  const [, after] = splitPromptSkillContent(content, slashCommand.end);
  const alreadySelected = content.some(
    (part) => part.type === "skill" && part.skill.id === skill.id,
  );
  return normalizePromptSkillContent([
    ...before,
    ...(alreadySelected ? [] : [{ skill, type: "skill" as const }]),
    ...after,
  ]);
}

export function insertPromptFileReference(
  content: PromptSkillContent,
  mention: Pick<PromptSlashCommand, "end" | "start">,
  file: ProjectFileSearchEntry,
): PromptSkillContent {
  const [before] = splitPromptSkillContent(content, mention.start);
  const [, after] = splitPromptSkillContent(content, mention.end);
  const alreadySelected = content.some(
    (part) =>
      part.type === "file" && projectFileReferenceKey(part.file) === projectFileReferenceKey(file),
  );
  return normalizePromptSkillContent([
    ...before,
    ...(alreadySelected ? [] : [{ file, type: "file" as const }]),
    ...after,
  ]);
}

export function appendPromptFileReference(
  content: PromptSkillContent,
  file: ProjectFileSearchEntry,
): PromptSkillContent {
  if (
    content.some(
      (part) =>
        part.type === "file" &&
        projectFileReferenceKey(part.file) === projectFileReferenceKey(file),
    )
  ) {
    return content;
  }
  const serializedText = serializePromptSkillContent(content);
  return normalizePromptSkillContent([
    ...content,
    ...(serializedText === "" || /\s$/u.test(serializedText)
      ? []
      : [{ text: " ", type: "text" as const }]),
    { file, type: "file" },
  ]);
}

export function recognizePromptSkillReferences(
  content: PromptSkillContent,
  availableSkills: readonly AgentSkill[],
): PromptSkillContent {
  const skillsByName = new Map(availableSkills.map((skill) => [skill.name, skill]));
  const selectedSkillIds = new Set(
    content.flatMap((part) => (part.type === "skill" ? [part.skill.id] : [])),
  );
  const recognized: PromptSkillContentPart[] = [];
  let changed = false;

  for (const part of content) {
    if (part.type !== "text") {
      recognized.push(part);
      continue;
    }

    let textOffset = 0;
    for (const match of part.text.matchAll(/\$([^\s$]+)/gu)) {
      const referenceStart = match.index;
      const skillName = match[1];
      const precedingCharacter = part.text[referenceStart - 1];
      const skill = skillName === undefined ? undefined : skillsByName.get(skillName);
      if (
        skill === undefined ||
        (precedingCharacter !== undefined && !/\s/u.test(precedingCharacter))
      ) {
        continue;
      }

      const referenceEnd = referenceStart + match[0].length;
      recognized.push({ text: part.text.slice(textOffset, referenceStart), type: "text" });
      if (!selectedSkillIds.has(skill.id)) {
        recognized.push({ skill, type: "skill" });
        selectedSkillIds.add(skill.id);
      }
      textOffset = referenceEnd;
      changed = true;
    }
    recognized.push({ text: part.text.slice(textOffset), type: "text" });
  }

  return changed ? normalizePromptSkillContent(recognized) : content;
}

export function parsePromptReferenceText(
  text: string,
  previous: PromptSkillContent,
  availableSkills: readonly AgentSkill[],
): PromptSkillContent {
  // 只把完整匹配的已知引用恢复为提交元数据；改名或删掉的片段立即退回普通文本。
  const skills = new Map(availableSkills.map((skill) => [skillPlainText(skill), skill]));
  const files = new Map<string, ProjectFileSearchEntry>();
  for (const part of previous) {
    if (part.type === "skill") skills.set(skillPlainText(part.skill), part.skill);
    if (part.type === "file") files.set(fileReferencePlainText(part.file), part.file);
  }
  const references = [...skills.keys(), ...files.keys()].sort((a, b) => b.length - a.length);
  const parts: PromptSkillContentPart[] = [];
  let start = 0;
  let position = 0;
  const selectedSkills = new Set<string>();
  while (position < text.length) {
    const boundary = position === 0 || /\s/u.test(text[position - 1] ?? "");
    const reference = boundary && (text[position] === "$" || text[position] === "@")
      ? references.find((value) => text.startsWith(value, position))
      : undefined;
    if (reference === undefined) {
      position += 1;
      continue;
    }
    const end = position + reference.length;
    const next = text[end];
    const continuesReference = reference.startsWith("$")
      ? next !== undefined && /[\w/\\-]/u.test(next)
      : next !== undefined && !/[\s,!?;:，。！？；：、()[\]{}"'`]/u.test(next);
    if (continuesReference) {
      position += 1;
      continue;
    }
    if (start < position) parts.push({ text: text.slice(start, position), type: "text" });
    const skill = skills.get(reference);
    const file = files.get(reference);
    if (skill !== undefined && !selectedSkills.has(skill.id)) {
      parts.push({ skill, type: "skill" });
      selectedSkills.add(skill.id);
    } else if (file !== undefined) {
      parts.push({ file, type: "file" });
    } else {
      parts.push({ text: reference, type: "text" });
    }
    position = end;
    start = end;
  }
  if (start < text.length) parts.push({ text: text.slice(start), type: "text" });
  return normalizePromptSkillContent(parts);
}

export function removePromptSlashCommand(
  content: PromptSkillContent,
  slashCommand: Pick<PromptSlashCommand, "end" | "start">,
): PromptSkillContent {
  const [before] = splitPromptSkillContent(content, slashCommand.start);
  const [, after] = splitPromptSkillContent(content, slashCommand.end);
  return normalizePromptSkillContent([...before, ...after]);
}

export function removePromptSkill(
  content: PromptSkillContent,
  skillId: string,
): PromptSkillContent {
  return normalizePromptSkillContent(
    content.filter((part) => part.type !== "skill" || part.skill.id !== skillId),
  );
}

export function removePromptFileReference(
  content: PromptSkillContent,
  file: Pick<ProjectFileSearchEntry, "path" | "rootId">,
): PromptSkillContent {
  const key = projectFileReferenceKey(file);
  return normalizePromptSkillContent(
    content.filter((part) => part.type !== "file" || projectFileReferenceKey(part.file) !== key),
  );
}

export function serializePromptSkillContent(content: PromptSkillContent): string {
  return content
    .map((part) =>
      part.type === "text"
        ? part.text
        : part.type === "skill"
          ? skillPlainText(part.skill)
          : fileReferencePlainText(part.file),
    )
    .join("");
}

export function toPromptSkillSubmission(content: PromptSkillContent): PromptSkillSubmission {
  const skills: AgentSkill[] = [];
  const seenSkillIds = new Set<string>();
  for (const part of content) {
    if (part.type === "skill" && !seenSkillIds.has(part.skill.id)) {
      skills.push(part.skill);
      seenSkillIds.add(part.skill.id);
    }
  }
  // Codex App Server 需要正文中的 `$name` 与独立 skill 输入同时存在。
  return { skills, text: serializePromptSkillContent(content).trim() };
}

export function isPromptSkillContentEmpty(content: PromptSkillContent): boolean {
  const submission = toPromptSkillSubmission(content);
  return submission.text === "" && submission.skills.length === 0;
}
