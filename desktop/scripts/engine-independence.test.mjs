import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';

// 文件与 Git 的项目授权属于应用目录边界，不能把 Codex 运行状态作为授权前提。
void test('native workspace authorization works without a Codex process', async()=>{
 const source=await readFile(new URL('../src-tauri/src/application/workspace_commands.rs',import.meta.url),'utf8');
 const body=source.split('pub(super) async fn project_root(')[1].split('#[tauri::command')[0];
 assert.doesNotMatch(body,/codex_connection\(|codex::read_project\(/);
});

// 预览与终端使用同一份应用归属信息，覆盖聊天以外的单引擎入口。
void test('native file previews and terminal creation use application ownership', async () => {
  const preview = await readFile(new URL('../src-tauri/src/application/task_workspace.rs', import.meta.url), 'utf8');
  assert.doesNotMatch(preview.split('pub(crate) async fn resolve_preview_root(')[1].split('pub(crate) fn relative_preview_path')[0], /codex_connection\(|codex::/);
  const terminal = await readFile(new URL('../src-tauri/src/application/terminal_commands.rs', import.meta.url), 'utf8');
  assert.doesNotMatch(terminal.split('pub async fn create_project_terminal(')[1].split('#[tauri::command]')[0], /codex_connection\(|codex::/);
});

// 工作树任务与普通任务共用应用目录创建流程，不能绕过双引擎分流直接建立 Codex 会话。
void test('worktree task creation uses the engine-independent task catalog', async () => {
  const source = await readFile(new URL('../src-tauri/src/application/worktree_task_commands.rs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /codex_connection\(|codex::/);
  assert.match(source, /task_workspace::start_task_for_engine/);
});
