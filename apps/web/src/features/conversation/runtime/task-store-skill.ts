import { stripLeadingAgentSkillReferences, type AgentItem } from "@code-agent/protocol";

export function mergeRealtimeExpandedSkill(
  previousItem: AgentItem | undefined,
  expandedItem: AgentItem,
): AgentItem | undefined {
  if (
    previousItem?.type !== "message" ||
    previousItem.role !== "user" ||
    expandedItem.type !== "message" ||
    expandedItem.role !== "user" ||
    expandedItem.text.length > 0 ||
    (expandedItem.skills?.length ?? 0) === 0
  ) {
    return undefined;
  }

  const skillNames = new Set((previousItem.skills ?? []).map((skill) => skill.name));
  const skills = [...(previousItem.skills ?? [])];
  for (const skill of expandedItem.skills ?? []) {
    if (!skillNames.has(skill.name)) {
      skillNames.add(skill.name);
      skills.push(skill);
    }
  }

  return {
    ...previousItem,
    skills,
    text: stripLeadingAgentSkillReferences(previousItem.text, skills),
  };
}
