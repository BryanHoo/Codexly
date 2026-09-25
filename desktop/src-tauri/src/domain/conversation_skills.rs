use std::collections::HashSet;

use crate::domain::conversation::AgentItem;

/// 原位归并完整回合中的相邻 Skill 展开项，保留用户实体身份与附件。
pub(crate) fn normalize_turn_skills(items: &mut Vec<AgentItem>) {
    // 必须先判断原始正文是否为空；清理后变空的 `$skill` 消息仍是独立用户输入。
    items.dedup_by(|expanded, previous| {
        let AgentItem::Message {
            role: "user",
            skill_expansion: true,
            text,
            skills: Some(extra),
            attachments,
            questions,
            phase,
            ..
        } = expanded
        else {
            return false;
        };
        if !text.is_empty()
            || extra.is_empty()
            || attachments.as_ref().is_some_and(|items| !items.is_empty())
            || questions.is_some()
            || phase.is_some()
        {
            return false;
        }
        let AgentItem::Message {
            role: "user",
            skills,
            ..
        } = previous
        else {
            return false;
        };
        // 移动元数据而非克隆正文；整组归并后只做一次去重和前缀扫描。
        skills.get_or_insert_with(Vec::new).append(extra);
        true
    });
    for item in items {
        normalize_user_skill_text(item);
    }
}

pub(crate) fn normalize_user_skill_text(item: &mut AgentItem) {
    let AgentItem::Message {
        role: "user",
        text,
        skills: Some(skills),
        ..
    } = item
    else {
        return;
    };
    normalize_skill_fields(text, skills);
}

pub(crate) fn normalize_skill_fields(text: &mut String, skills: &mut Vec<serde_json::Value>) {
    if skills.is_empty() {
        return;
    }
    let mut names = HashSet::with_capacity(skills.len());
    skills.retain(|skill| {
        skill["name"]
            .as_str()
            .is_some_and(|name| names.insert(name.to_owned()))
    });
    let mut remaining = text.as_str();
    let mut removed = false;
    while let Some(reference) = remaining
        .trim_start_matches(reference_whitespace)
        .strip_prefix('$')
    {
        let end = reference
            .find(|ch: char| ch == '$' || reference_whitespace(ch))
            .unwrap_or(reference.len());
        if end == 0 || !names.contains(&reference[..end]) {
            break;
        }
        remaining = &reference[end..];
        removed = true;
    }
    if removed {
        // 一次移动剩余正文，避免每个 Skill 引用都复制一遍整段消息。
        let removed_bytes = text.len() - remaining.trim_start_matches(reference_whitespace).len();
        text.drain(..removed_bytes);
    }
}

fn reference_whitespace(ch: char) -> bool {
    // 与输入端的 ECMAScript 空白边界一致，包含 BOM，排除 Unicode NEL。
    ch == '\u{feff}' || (ch.is_whitespace() && ch != '\u{0085}')
}
