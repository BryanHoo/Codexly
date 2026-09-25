use serde_json::{Value, json};

use crate::domain::{
    conversation::AgentItem, conversation_skills::normalize_skill_fields, runtime::AgentEvent,
};

pub(super) const MAX_ENTRY_BYTES: usize = 1_100_000;
pub(super) const MAX_SKILLS: usize = 128;
const MAX_ID_BYTES: usize = 1_024;

/// 只保存归并需要的字段；附件、问题、工具输出均不进入跨事件缓存。
pub(super) struct SkillMessage {
    pub id: String,
    pub text: String,
    pub skills: Vec<Value>,
    pub expansion: bool,
}

impl SkillMessage {
    pub fn prepare(event: &AgentEvent) -> Option<Self> {
        let json = event.as_json()?;
        let item = match event.event_type()? {
            "item.started" | "item.completed" => json.pointer("/payload/item")?,
            "turn.started" => json.pointer("/payload/turn/items")?.as_array()?.last()?,
            _ => return None,
        };
        Self::from_json(item)
    }

    fn from_json(item: &Value) -> Option<Self> {
        if item["type"] != "message" || item["role"] != "user" {
            return None;
        }
        Self::from_parts(
            item["id"].as_str()?,
            item["text"].as_str()?,
            item["skills"].as_array().map_or(&[], Vec::as_slice),
            item["skillExpansion"] == true,
        )
    }

    pub fn from_item(item: &AgentItem) -> Option<Self> {
        let AgentItem::Message {
            id,
            text,
            skills,
            skill_expansion,
            role: "user",
            ..
        } = item
        else {
            return None;
        };
        Self::from_parts(
            id,
            text,
            skills.as_deref().unwrap_or_default(),
            *skill_expansion,
        )
    }

    fn from_parts(id: &str, text: &str, skills: &[Value], expansion: bool) -> Option<Self> {
        // 在 Runtime 锁外校验预算后再复制正文；普通 delta 不走此路径。
        if id.is_empty() || id.len() > MAX_ID_BYTES || skills.len() > MAX_SKILLS {
            return None;
        }
        let names = skills
            .iter()
            .map(|skill| skill["name"].as_str())
            .collect::<Option<Vec<_>>>()?;
        if names
            .iter()
            .any(|name| name.is_empty() || name.len() > MAX_ID_BYTES)
        {
            return None;
        }
        let bytes = id
            .len()
            .saturating_add(text.len())
            .saturating_add(names.iter().map(|name| name.len()).sum::<usize>());
        if bytes > MAX_ENTRY_BYTES {
            return None;
        }
        Some(Self {
            id: id.into(),
            text: text.into(),
            skills: names.into_iter().map(|name| json!({"name":name})).collect(),
            expansion,
        })
    }

    pub fn bytes(&self) -> usize {
        self.id.len()
            + self.text.len()
            + self
                .skills
                .iter()
                .filter_map(|skill| skill["name"].as_str())
                .map(str::len)
                .sum::<usize>()
    }

    pub fn merge(&mut self, extra: &[Value]) -> bool {
        // 合并前限制临时容器容量，重复生命周期通知不会无限增长。
        if self.skills.len() + extra.len() > MAX_SKILLS * 2 {
            return false;
        }
        let mut skills = self.skills.clone();
        skills.extend_from_slice(extra);
        let mut unused_text = String::new();
        normalize_skill_fields(&mut unused_text, &mut skills);
        let bytes = self.id.len()
            + self.text.len()
            + skills
                .iter()
                .filter_map(|skill| skill["name"].as_str())
                .map(str::len)
                .sum::<usize>();
        if skills.len() > MAX_SKILLS || bytes > MAX_ENTRY_BYTES {
            return false;
        }
        self.skills = skills;
        normalize_skill_fields(&mut self.text, &mut self.skills);
        true
    }

    pub fn payload(&self) -> Value {
        json!({"text":self.text,"skills":self.skills})
    }
}
