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

顶部固定高度为 72px，仅包含分支信息行与状态操作行，不预留额外提示行。状态统一使用 24px 徽标，待推送保留蓝色可点击样式；下一步操作使用 24px 小按钮，固定在第二行右侧。正常状态不显示额外提示；失败仅显示简短原因与详情入口，完整建议放在弹窗中，切换状态不改变文件列表的位置。两行工具栏展示：当前分支与推送目标、待推送/待拉取数量和一个下一步主操作。同步后主操作为获取更新；获取进度只显示在获取入口，不改变推送按钮名称。配置、状态检查和远端信息位于更多菜单，发布分支与创建分支使用弹窗。未推送数量可点击打开历史；检查时间、地址和提交哈希只在信息弹窗中展示。

历史中的「未推送」标记表示该提交尚未包含在当前推送目标的本地远端引用中。点击变更顶部的「待推送 N 个提交」可打开当前项目历史；推送成功后标记自动更新。状态依据已获取的远端引用，需要最新远端信息时先获取更新；没有明确推送目标或对应引用时不猜测状态。

## 推送失败后继续

「提交并推送」可能完成提交但未完成推送。看到「提交已保存，推送未完成」时，本地提交已经存在；排查远端连接或权限后使用「重试推送」，无需重新提交。只执行「提交」时，结果显示「已保存到本地，尚未推送」。推送失败仅在顶部显示一次按应用语言提供的简短原因和详情入口，处理建议与技术原文在详情弹窗中展示；下方不重复显示红色错误，没有变更时留白。

尚未配置远端时点击「配置远端」，在弹窗中填写名称和地址；保存失败保留输入以便重试。已有远端但当前分支没有上游时，点击「发布分支」，审阅远端和分支后发布。首次发布会建立跟踪关系。

错误卡片按认证、权限、网络、远端更新、分支规则等原因提供处理建议，并保留提交 SHA。刷新后仍能恢复同一 HEAD 的错误分类；原始日志只放在「查看详情」弹窗，不写入持久回执。

远端包含新提交时先「获取远端更新」，再「拉取更新」。拉取要求先提交当前变更，并且只允许快进更新，不创建合并或冲突。本地与远端历史分叉，或存在未完成的 Git 操作时，请在外部 Git 工具处理，然后回到应用「刷新状态」。本软件不提供冲突编辑、标记解决、完成或取消合并。分支保护拒绝推送时可创建功能分支，再发布并到远端发起 Pull Request。

「检查远端状态」只读取 Git 主机上的本地配置与已有远端引用，界面显示本地检查时间；点击「获取远端更新」才访问网络并更新引用。提交后的状态检查会等待 Git 写操作完成再执行；提前到达的新状态不会触发竞争检查，通常无需手动重试。推送前读取当前分支的最新提交，再绑定该 HEAD 和分支执行；新增工作区修改不阻塞推送，执行期间 HEAD 或分支变化则停止并提示刷新确认后重试。只读检查可在工作区快照过期后刷新状态。Git 操作发生在运行 Codexly 的电脑上；Web 从其他设备访问时也使用服务端电脑的 Git 身份和远端认证配置。

## Commit and push

This guide applies to Web, including mobile, and desktop. Select a project root and branch in the Git panel. The project root must be a Git repository; ordinary subdirectories do not use a parent repository.

| Action                | Result                                                                             |
| --------------------- | ---------------------------------------------------------------------------------- |
| Commit                | Create a local commit from the selected files and message, without pushing         |
| Commit and push       | Create a local commit, then push the current branch's local commits                |
| Push existing commits | Push saved commits without creating a commit or changing the index or working tree |

The workspace keeps remote actions at the top, file review in the middle and the commit editor at the bottom. Messages survive refreshes and reopening on the same device, scoped by project, worktree and branch. Each opening selects all current files by default; manual exclusions survive refreshes within that opening. No range review notice or acknowledgement is shown. Partially staged files include the staged version only, consistently across preview, AI and commit. Newly discovered or paged files are not silently selected.

The footer uses one message field, including multiline content, and commit actions only. AI generation directly replaces the current message when it succeeds, without a confirmation step. Undo generation to restore the previous message. Responses for an outdated selection are discarded. Only a successful commit clears the draft. Push existing commits from the persistent remote toolbar, even with working changes.

The toolbar stays 72px tall across all states with a branch row and a status/action row, without a reserved notice line. Status badges and the next-action button are 24px tall; outgoing commits keep their blue clickable badge, and the next action stays on the lower right. Normal states show no extra notice; failures show a short reason and a details link, with full guidance in a dialog. This keeps the file list from shifting. The two action rows show branch and destination context, incoming/outgoing counts and one next action. Fetch is the primary action after synchronization. Fetch progress stays on its own control. The more menu contains configuration, status checks and remote information; publishing and branch creation use dialogs. Addresses, check time and commit hashes stay in the information dialog.

History marks commits as **Unpushed** when they are not included in the cached reference for the current push destination. Click **N commits to push** in Changes to open the project history. Marks refresh after a successful push. Fetch to update cached remote references; no status is guessed when the destination or its reference is unknown.

If the result says **Commit saved, push incomplete**, the local commit already exists. Resolve the remote connection or authentication problem and use **Retry push**. A plain commit shows **Saved locally, not pushed yet**. Failures appear once in the remote toolbar with guidance in the app language; original technical errors appear only in the details dialog. The area below stays blank when there are no working changes.

Use the **Configure remote** dialog to edit the destination; failed saves keep your inputs for retry. Use **Publish branch** to establish upstream tracking. The primary action adapts to connection, authentication, remote updates and repository rules; persisted receipts retain the failure category for the same HEAD, without storing raw logs.

Fetch remote updates, then pull after committing working changes. Pulls allow fast-forward updates only and do not create a merge or conflicts. Handle diverged histories or unfinished Git operations in an external Git tool, then refresh the status. The app does not provide conflict editing, marking resolved, or completing or cancelling merges. Protected-branch failures offer feature branch creation; publish that branch and open a pull request on the remote host.

Status checks read local configuration and cached remote references; fetch explicitly to update them. After a commit, automatic checks wait for Git writes to finish, so early metadata updates do not trigger competing reads or leave transient errors requiring manual retry. Pushes first read the current commit, then bind its HEAD and branch, so unrelated working edits do not block them. A concurrent commit or branch change stops the push; refresh, confirm the branch, and retry. Read-only checks can refresh an outdated worktree snapshot. Web uses the Git identity and credentials on the computer running its server, even when accessed from another device.
