use crate::domain::conversation::AgentPromptInput;

pub(super) fn prompt_task_title(input: &AgentPromptInput) -> Option<&str> {
    // 与任务预览保持一致，只取首个非空输入行，避免长提示撑大原生菜单。
    input
        .text
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .or_else(|| first_named_item(&input.skills))
        .or_else(|| first_named_item(&input.attachments))
}

fn first_named_item(items: &[serde_json::Value]) -> Option<&str> {
    items
        .iter()
        .filter_map(|item| item.get("name").and_then(serde_json::Value::as_str))
        .map(str::trim)
        .find(|name| !name.is_empty())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::prompt_task_title;
    use crate::domain::conversation::AgentPromptInput;

    #[test]
    fn prompt_title_should_follow_text_skill_and_attachment_priority() {
        let text_input = AgentPromptInput {
            attachments: vec![json!({"name": "report.json"})],
            skills: vec![json!({"name": "review"})],
            text: "  \n  修复后台标题  \n忽略后续行".to_owned(),
        };
        assert_eq!(prompt_task_title(&text_input), Some("修复后台标题"));

        let skill_input = AgentPromptInput {
            attachments: vec![json!({"name": "report.json"})],
            skills: vec![json!({"name": "review"})],
            text: " \n ".to_owned(),
        };
        assert_eq!(prompt_task_title(&skill_input), Some("review"));

        let attachment_input = AgentPromptInput {
            attachments: vec![json!({"name": "report.json"})],
            skills: Vec::new(),
            text: String::new(),
        };
        assert_eq!(prompt_task_title(&attachment_input), Some("report.json"));
    }
}
