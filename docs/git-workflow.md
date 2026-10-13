# Git 提交与推送

本指南适用于 Codexly Web（含移动端）与桌面端。在工作台 Git 面板选择项目根目录和当前分支后，可分别保存变更或推送已有提交。项目根目录必须是 Git 仓库；普通子目录不会借用父目录的仓库。

## 选择操作

| 操作         | 使用场景             | 结果                                                     |
| ------------ | -------------------- | -------------------------------------------------------- |
| 提交         | 先在本地保存变更     | 用所选文件和提交信息创建本地提交，不推送                 |
| 提交并推送   | 保存变更并同步到远端 | 先创建本地提交，再推送当前分支的本地提交                 |
| 推送已有提交 | 已提交，稍后再同步   | 推送当前分支已有提交，不创建新提交，不改动暂存区或工作区 |

提交前选择需要保存的文件并填写提交信息，也可使用提交信息生成操作。主按钮执行「提交」；从「更多 Git 操作」选择「提交并推送」或「推送已有提交」。即使面板显示「暂无未提交变更」，仍可推送已有提交。

## 推送失败后继续

「提交并推送」可能完成提交但未完成推送。看到「提交已保存，推送未完成」时，本地提交已经存在；排查远端连接或权限后使用「重试推送」，无需重新提交。只执行「提交」时，结果显示「已保存到本地，尚未推送」。

推送使用当前分支配置的上游。尚未配置上游时，先在项目终端中设置远端跟踪分支，再回到面板推送。例如已配置名为 `origin` 的远端、当前分支为 `main` 时：

```bash
git push --set-upstream origin main
```

按实际远端和分支名称调整命令。Git 操作发生在运行 Codexly 的电脑上；Web 从其他设备访问时也使用服务端电脑的 Git 身份和远端认证配置。

## Commit and push

This guide applies to Web, including mobile, and desktop. Select a project root and branch in the Git panel. The project root must be a Git repository; ordinary subdirectories do not use a parent repository.

| Action                | Result                                                                             |
| --------------------- | ---------------------------------------------------------------------------------- |
| Commit                | Create a local commit from the selected files and message, without pushing         |
| Commit and push       | Create a local commit, then push the current branch's local commits                |
| Push existing commits | Push saved commits without creating a commit or changing the index or working tree |

Select files and enter or generate a commit message before committing. The main button commits; use **More Git actions** for **Commit and push** or **Push existing commits**. Existing commits can still be pushed when there are no uncommitted changes.

If the result says **Commit saved, push incomplete**, the local commit already exists. Resolve the remote connection or authentication problem and use **Retry push**. A plain commit shows **Saved locally, not pushed yet**.

Pushing uses the current branch's upstream. Configure it in a project terminal first if it is missing; for a branch named `main` and a remote named `origin`, use `git push --set-upstream origin main`. Adjust the names to your repository. Web uses the Git identity and credentials on the computer running its server, even when accessed from another device.
