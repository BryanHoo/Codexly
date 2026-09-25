use serde_json::{Value, json};

pub(super) fn map_plugin_skills(plugin: &Value) -> Vec<Value> {
    let mut skills = map_named_assets(plugin.get("skills"));
    let Some(onboarding_skill) = plugin.get("onboardingSkill").and_then(map_named_asset) else {
        return skills;
    };
    let onboarding_name = onboarding_skill.get("name").and_then(Value::as_str);
    if !skills
        .iter()
        .any(|skill| skill.get("name").and_then(Value::as_str) == onboarding_name)
    {
        // 0.156 将引导技能独立返回，合并后前端仍可复用只读技能列表。
        skills.push(onboarding_skill);
    }
    skills
}

fn map_named_assets(value: Option<&Value>) -> Vec<Value> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(map_named_asset)
        .collect()
}

fn map_named_asset(asset: &Value) -> Option<Value> {
    Some(json!({
        "description": asset.get("shortDescription").or_else(|| asset.get("description")).and_then(Value::as_str).unwrap_or_default(),
        "name": asset.get("name")?.as_str()?,
    }))
}

pub(super) fn map_apps(value: Option<&Value>) -> Vec<Value> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|app| {
            Some(json!({
                "description": app.get("description").and_then(Value::as_str).unwrap_or_default(),
                "id": app.get("id")?.as_str()?,
                "installUrl": app.get("installUrl").cloned().unwrap_or(Value::Null),
                "name": app.get("name")?.as_str()?,
            }))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::map_plugin_skills;

    #[test]
    fn onboarding_skill_should_not_duplicate_a_regular_skill() {
        let skills = map_plugin_skills(&json!({
            "skills": [{"name": "setup", "description": "Set up"}],
            "onboardingSkill": {"name": "setup", "shortDescription": "Set up again"},
        }));

        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0]["name"], "setup");
    }
}
