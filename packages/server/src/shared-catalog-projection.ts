// 桌面端直接写领域表；数据库触发器在同一事务内维护 Web 旧业务表的外键投影。
// 根 ID 使用稳定的项目身份；Web 显式写入时仍可替换为既有路径摘要 ID。
export const SHARED_CATALOG_PROJECTION_SQL = `
INSERT INTO projects (id,name,created_at,sort_order,kind)
SELECT id,name,created_at,position,'user' FROM managed_projects WHERE true
ON CONFLICT(id) DO NOTHING;
INSERT INTO project_roots (project_id,position,root_id,path)
SELECT id,0,id,path FROM managed_projects WHERE true ON CONFLICT DO NOTHING;

CREATE TRIGGER shared_project_insert AFTER INSERT ON managed_projects BEGIN
  INSERT INTO projects (id,name,created_at,sort_order,kind)
  VALUES (NEW.id,NEW.name,NEW.created_at,NEW.position,'user') ON CONFLICT(id) DO NOTHING;
  INSERT INTO project_roots (project_id,position,root_id,path)
  VALUES (NEW.id,0,NEW.id,NEW.path) ON CONFLICT DO NOTHING;
END;
CREATE TRIGGER shared_project_update AFTER UPDATE ON managed_projects BEGIN
  UPDATE projects SET name=NEW.name,sort_order=NEW.position WHERE id=NEW.id;
  UPDATE project_roots SET path=NEW.path WHERE project_id=NEW.id AND position=0;
END;
CREATE TRIGGER shared_project_delete AFTER DELETE ON managed_projects BEGIN
  DELETE FROM projects WHERE id=OLD.id AND kind='user';
END;
CREATE TRIGGER shared_task_delete AFTER DELETE ON managed_tasks BEGIN
  DELETE FROM task_settings WHERE task_id=OLD.id AND project_id=COALESCE(OLD.project_id,'temporary');
  DELETE FROM task_queue WHERE task_id=OLD.id AND project_id=COALESCE(OLD.project_id,'temporary');
  DELETE FROM async_questions WHERE task_id=OLD.id AND project_id=COALESCE(OLD.project_id,'temporary');
END;
`;
