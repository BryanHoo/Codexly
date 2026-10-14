# Git 提交与推送

本指南适用于 Codexly Web（含移动端）与桌面端。在工作台 Git 面板选择项目根目录和当前分支后，可分别保存变更或推送已有提交。项目根目录必须是 Git 仓库；普通子目录不会借用父目录的仓库。

## 选择操作

| 操作         | 使用场景             | 结果                                                     |
| ------------ | -------------------- | -------------------------------------------------------- |
| 提交         | 先在本地保存变更     | 用所选文件和提交信息创建本地提交，不推送                 |
| 提交并推送   | 保存变更并同步到远端 | 先创建本地提交，再推送当前分支的本地提交                 |
| 推送已有提交 | 已提交，稍后再同步   | 推送当前分支已有提交，不创建新提交，不改动暂存区或工作区 |

变更工作区顶部显示当前分支、推送目标与待推送/待拉取数量，中间审查文件，底部编辑提交信息。顶部推送入口始终可见，未提交文件不影响推送已有提交。主按钮执行「提交」；从「更多 Git 操作」选择「提交并推送」，独立推送统一使用顶部入口。

提交信息草稿按项目、工作树和分支保存在当前设备，刷新或重新打开后保留。每次打开「变更」默认全选当前文件，包含已暂存和未暂存文件；打开后可取消勾选，普通刷新保留本次选择。部分暂存文件只提交已暂存内容，差异预览和 AI 使用相同范围。桌面分页中的全选仅针对已加载文件，后续新增文件或继续加载不自动扩大提交范围。界面不显示变更范围审查提示。

提交信息使用单一输入框，支持多行内容。点击「AI 生成」后，生成成功会直接替换当前提交信息，无需再次确认；可通过「撤销生成」恢复替换前的内容。生成期间改变范围的结果会被丢弃，草稿仍保留。成功提交后清除已使用的草稿；失败后可以继续编辑。

## 推送失败后继续

「提交并推送」可能完成提交但未完成推送。看到「提交已保存，推送未完成」时，本地提交已经存在；排查远端连接或权限后使用「重试推送」，无需重新提交。只执行「提交」时，结果显示「已保存到本地，尚未推送」。

尚未配置远端时点击「配置远端」，在弹窗中填写名称和地址；保存失败保留输入以便重试。已有远端但当前分支没有上游时，点击「发布分支」，审阅远端和分支后发布。首次发布会建立跟踪关系。

错误卡片按认证、权限、网络、远端更新、分支规则等原因提供处理建议，并保留提交 SHA。刷新后仍能恢复同一 HEAD 的错误分类；原始日志只放在「查看详情」，不写入持久回执。

远端包含新提交时使用「获取远端更新」，然后「整合远端更新」。整合要求先处理未提交变更，保留仓库历史，不自动 stash、rebase 或强推。有冲突时可在原有文本编辑器打开冲突文件，保存后点击「标记已解决」，再「完成合并」；也可「取消合并」。分支保护拒绝推送时可创建功能分支，再发布并到远端发起 Pull Request。

「检查远端状态」只读取 Git 主机上的本地配置与已有远端引用，界面显示本地检查时间；点击「获取远端更新」才访问网络并更新引用。推送绑定已审阅的 HEAD 和分支，不因新增工作区修改而阻塞。Git 操作发生在运行 Codexly 的电脑上；Web 从其他设备访问时也使用服务端电脑的 Git 身份和远端认证配置。

## Commit and push

This guide applies to Web, including mobile, and desktop. Select a project root and branch in the Git panel. The project root must be a Git repository; ordinary subdirectories do not use a parent repository.

| Action                | Result                                                                             |
| --------------------- | ---------------------------------------------------------------------------------- |
| Commit                | Create a local commit from the selected files and message, without pushing         |
| Commit and push       | Create a local commit, then push the current branch's local commits                |
| Push existing commits | Push saved commits without creating a commit or changing the index or working tree |

The workspace keeps remote actions at the top, file review in the middle and the commit editor at the bottom. Messages survive refreshes and reopening on the same device, scoped by project, worktree and branch. Each opening selects all current files by default; manual exclusions survive refreshes within that opening. No range review notice or acknowledgement is shown. Partially staged files include the staged version only, consistently across preview, AI and commit. Newly discovered or paged files are not silently selected.

The footer uses one message field, including multiline content, and commit actions only. AI generation directly replaces the current message when it succeeds, without a confirmation step. Undo generation to restore the previous message. Responses for an outdated selection are discarded. Only a successful commit clears the draft. Push existing commits from the persistent remote toolbar, even with working changes.

If the result says **Commit saved, push incomplete**, the local commit already exists. Resolve the remote connection or authentication problem and use **Retry push**. A plain commit shows **Saved locally, not pushed yet**.

Use the **Configure remote** dialog to edit the destination; failed saves keep your inputs for retry. Use **Publish branch** to establish upstream tracking. Error cards provide recovery actions for connection, authentication, remote updates and repository rules; persisted receipts retain the failure category for the same HEAD, without storing raw logs.

Fetch and integrate remote updates after addressing working changes. Open conflict files in the existing text editor, save, mark them resolved and complete the merge, or cancel it. Protected-branch failures offer feature branch creation; publish that branch and open a pull request on the remote host.

Status checks read local configuration and cached remote references; fetch explicitly to update them. Pushes bind the reviewed HEAD and branch, so unrelated working edits do not block them. Web uses the Git identity and credentials on the computer running its server, even when accessed from another device.
