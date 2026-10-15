use super::ConnectionError;
use crate::infrastructure::{local_settings, task_settings};
use serde_json::Value;
use std::path::Path;

pub(super) async fn copy_migrated_settings(
    app_data: &Path,
    projects: &[Value],
    tasks: &[Value],
) -> Result<(), ConnectionError> {
    for project in projects {
        let (Some(source), Some(target)) = (project["sourceId"].as_str(), project["id"].as_str())
        else {
            continue;
        };
        if source == target {
            continue;
        }
        if local_settings::read_project_defaults(app_data, target)
            .await
            .map_err(|_| ConnectionError::StateUnavailable)?
            .is_none()
            && let Some(settings) = local_settings::read_project_defaults(app_data, source)
                .await
                .map_err(|_| ConnectionError::StateUnavailable)?
        {
            local_settings::update_project_defaults(app_data, target, settings)
                .await
                .map_err(|_| ConnectionError::StateUnavailable)?;
        }
    }
    for task in tasks {
        let (Some(source), Some(target), Some(id)) = (
            task["sourceId"].as_str(),
            task["projectId"].as_str(),
            task["id"].as_str(),
        ) else {
            continue;
        };
        if source == target {
            continue;
        }
        if task_settings::read_task_settings(app_data, target, id)
            .await
            .map_err(|_| ConnectionError::StateUnavailable)?
            .is_none()
            && let Some(settings) = task_settings::read_task_settings(app_data, source, id)
                .await
                .map_err(|_| ConnectionError::StateUnavailable)?
        {
            task_settings::write_task_settings(app_data, target, id, &settings)
                .await
                .map_err(|_| ConnectionError::StateUnavailable)?;
        }
    }
    Ok(())
}
